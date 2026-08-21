/* eslint-disable for-ai/no-code-after-try-catch -- Socket state is processed after control-operation failures. */
/* eslint-disable for-ai/no-standalone-class -- The adapter is one stateful lifecycle coordinator. */
import { access } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import type { PullRequestSummary } from '../domain/pull-request.ts';
import type {
  ShutdownReason,
  ToolFailure,
  ToolId,
  ToolKind,
  ToolLaunchOutcome,
  ToolNotice,
  ToolRequest,
  ToolShutdownOutcome,
  ToolTabs,
} from './types.ts';

const HERDR_VERSION = '0.8.2';
const HERDR_PROTOCOL = 20;
const CONTROL_TIMEOUT_MS = 3_000;
const subscriptions = [
  'pane.created',
  'pane.exited',
  'pane.closed',
  'pane.moved',
  'tab.closed',
  'tab.moved',
  'workspace.closed',
] as const;

type AdapterOptions = {
  readonly reviewCommand: string;
  readonly workingDirectory: string;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly herdrEnvironment?: Readonly<NodeJS.ProcessEnv>;
  readonly controlTimeoutMs?: number;
};

type Pane = {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  label?: string;
};

type Snapshot = {
  version: string;
  protocol: number;
  workspaces: readonly { workspace_id: string }[];
  tabs: readonly { tab_id: string; workspace_id: string }[];
  panes: readonly Pane[];
};

type Resource = {
  paneId: string;
  terminalId: string;
  tabId: string;
  workspaceId: string;
};

type ToolRecord = {
  readonly toolId: ToolId;
  readonly kind: ToolKind;
  readonly label: string;
  phase: 'launching' | 'running' | 'indeterminate' | 'closing' | 'ended';
  resource?: Resource;
  returnedPaneId?: string;
  acknowledged: boolean;
  ordinaryExitSeen: boolean;
};

type RpcRequest = {
  readonly id: string;
  readonly method: string;
  readonly params: Record<string, unknown>;
};

type RpcResponse = {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { code?: unknown; message?: unknown };
};

export class HerdrStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HerdrStartupError';
  }
}

export async function createHerdrToolTabs(
  options: AdapterOptions
): Promise<ToolTabs> {
  const context = readContext(options.herdrEnvironment ?? process.env);
  const adapter = new HerdrToolTabs(options, context);
  await adapter.start();
  return adapter;
}

class HerdrToolTabs implements ToolTabs {
  readonly #reviewCommand: string;
  readonly #workingDirectory: string;
  readonly #environment: Readonly<NodeJS.ProcessEnv>;
  readonly #socketPath: string;
  readonly #timeoutMs: number;
  readonly #tools = new Map<ToolId, ToolRecord>();
  readonly #listeners = new Set<(notice: ToolNotice) => void>();
  readonly #unmatchedExitPaneIds = new Set<string>();
  #queue: Resource;
  #subscription?: Socket;
  #subscriptionConnected = false;
  #ordinaryEventsEnabled = false;
  #stopping = false;
  #launchesAllowed = true;
  #requestNumber = 0;
  #reconnectTask?: Promise<void>;

  constructor(
    options: AdapterOptions,
    context: {
      socketPath: string;
      workspaceId: string;
      tabId: string;
      paneId: string;
    }
  ) {
    this.#reviewCommand = options.reviewCommand;
    this.#workingDirectory = options.workingDirectory;
    this.#environment = options.environment;
    this.#socketPath = context.socketPath;
    this.#timeoutMs = options.controlTimeoutMs ?? CONTROL_TIMEOUT_MS;
    this.#queue = {
      paneId: context.paneId,
      terminalId: '',
      tabId: context.tabId,
      workspaceId: context.workspaceId,
    };
  }

  async start(): Promise<void> {
    let snapshot: Snapshot;
    try {
      snapshot = await this.#snapshot();
    } catch (error) {
      throw new HerdrStartupError(
        `Herdr v${HERDR_VERSION} is required. Start Herdr, then run review inside a Herdr pane. ${diagnostic(error)}`
      );
    }
    if (
      snapshot.version !== HERDR_VERSION ||
      snapshot.protocol !== HERDR_PROTOCOL
    ) {
      throw new HerdrStartupError(
        `Herdr v${HERDR_VERSION} with protocol ${HERDR_PROTOCOL} is required; found ${snapshot.version} with protocol ${snapshot.protocol}. Update Herdr and restart its server.`
      );
    }
    const queuePane = snapshot.panes.find(
      (pane) => pane.pane_id === this.#queue.paneId
    );
    const valid =
      queuePane?.workspace_id === this.#queue.workspaceId &&
      queuePane.tab_id === this.#queue.tabId &&
      snapshot.workspaces.some(
        (workspace) => workspace.workspace_id === this.#queue.workspaceId
      ) &&
      snapshot.tabs.some(
        (tab) =>
          tab.tab_id === this.#queue.tabId &&
          tab.workspace_id === this.#queue.workspaceId
      );
    if (!valid) {
      throw new HerdrStartupError(
        'The Herdr Review Queue pane, tab, and workspace context is not valid. Run review again inside an existing Herdr pane.'
      );
    }
    this.#queue = resourceOf(queuePane);
    await this.#connectSubscription(true);
  }

  subscribe(listener: (notice: ToolNotice) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async launch(request: ToolRequest): Promise<ToolLaunchOutcome> {
    if (this.#stopping) {
      return rejected('precondition', 'Tool Tabs are shutting down.');
    }
    if (!this.#launchesAllowed || !this.#subscriptionConnected) {
      return rejected(
        'precondition',
        'Tool launch is disabled until Herdr lifecycle tracking is restored or the indeterminate launch is acknowledged.'
      );
    }
    if (
      request.kind === 'lumen' &&
      !(await isInsideRepository(this.#workingDirectory))
    ) {
      return rejected(
        'precondition',
        'lumen diff requires review to start inside a Git or Jujutsu repository.'
      );
    }

    const toolId = crypto.randomUUID();
    const label = toolLabel(request.kind, request.pullRequest, toolId);
    const tool = createToolRecord(toolId, request.kind, label);
    this.#tools.set(toolId, tool);

    const command =
      request.kind === 'lumen'
        ? ['lumen', 'diff', request.pullRequest.url]
        : ['/bin/sh', '-c', this.#reviewCommand];
    const env = childEnvironment(
      this.#environment,
      request.kind,
      request.pullRequest,
      toolId
    );

    let response: unknown;
    try {
      response = await this.#request(
        'layout.apply',
        {
          workspace_id: this.#queue.workspaceId,
          tab_label: label,
          focus: true,
          root: {
            type: 'pane',
            label,
            cwd: this.#workingDirectory,
            command,
            env,
          },
        },
        false
      );
    } catch (error) {
      if (error instanceof RpcError) {
        this.#tools.delete(toolId);
        return rejected(
          'couldNotStart',
          `${command[0]} could not start for ${request.pullRequest.url}: Herdr ${error.code}: ${error.message}`,
          error.code
        );
      }
      return this.#settleUncertainLaunch(tool, error);
    }

    const layout = recordField(response, 'layout');
    const paneId = stringField(layout, 'focused_pane_id');
    tool.returnedPaneId = paneId;
    if (this.#unmatchedExitPaneIds.delete(paneId)) {
      tool.ordinaryExitSeen = true;
    }
    try {
      const pane = paneFromResult(
        await this.#request('pane.get', { pane_id: paneId })
      );
      return this.#confirmRunning(tool, pane);
    } catch (error) {
      if (error instanceof RpcError && error.code === 'pane_not_found') {
        return this.#endBeforeBaseline(tool);
      }
      return this.#retryPaneGet(tool, paneId, error);
    }
  }

  acknowledgeIndeterminateLaunch(toolId: ToolId): void {
    const tool = this.#tools.get(toolId);
    if (tool?.phase !== 'indeterminate') return;
    tool.acknowledged = true;
    this.#refreshLaunchInterlock();
  }

  shutdown(_reason: ShutdownReason): Promise<ToolShutdownOutcome> {
    this.#stopping = true;
    this.#launchesAllowed = false;
    return Promise.resolve({ ok: true });
  }

  async #retryPaneGet(
    tool: ToolRecord,
    paneId: string,
    firstError: unknown
  ): Promise<ToolLaunchOutcome> {
    this.#emit({
      type: 'controlFailure',
      toolId: tool.toolId,
      message: `Herdr could not identify the created Tool Tab pane. Review will retry ownership baselining. ${diagnostic(firstError)}`,
      ...(firstError instanceof RpcError ? { code: firstError.code } : {}),
    });
    while (!this.#stopping) {
      await Bun.sleep(50);
      try {
        const pane = paneFromResult(
          await this.#request('pane.get', { pane_id: paneId })
        );
        return this.#confirmRunning(tool, pane);
      } catch (error) {
        if (error instanceof RpcError && error.code === 'pane_not_found') {
          return this.#endBeforeBaseline(tool);
        }
      }
    }
    tool.phase = 'indeterminate';
    return { phase: 'indeterminate', toolId: tool.toolId };
  }

  async #confirmRunning(
    tool: ToolRecord,
    pane: Pane
  ): Promise<ToolLaunchOutcome> {
    tool.resource = resourceOf(pane);
    while (!this.#stopping) {
      try {
        const snapshot = await this.#snapshot();
        this.#reconcile(snapshot, false);
        if (tool.phase === 'ended') {
          return { phase: 'ended', toolId: tool.toolId };
        }
        const current = snapshot.panes.find(
          (candidate) => candidate.terminal_id === pane.terminal_id
        );
        if (!current) return this.#endBeforeBaseline(tool);
        tool.resource = resourceOf(current);
        tool.phase = 'running';
        this.#refreshLaunchInterlock();
        this.#emitPhase(tool, 'running');
        return { phase: 'running', toolId: tool.toolId };
      } catch {
        await Bun.sleep(50);
      }
    }
    tool.phase = 'indeterminate';
    return { phase: 'indeterminate', toolId: tool.toolId };
  }

  #endBeforeBaseline(tool: ToolRecord): ToolLaunchOutcome {
    if (tool.phase === 'ended') {
      return { phase: 'ended', toolId: tool.toolId };
    }
    tool.phase = 'ended';
    this.#refreshLaunchInterlock();
    this.#emitPhase(tool, 'ended');
    if (tool.ordinaryExitSeen) void this.#restoreQueueFocus(tool.toolId);
    return { phase: 'ended', toolId: tool.toolId };
  }

  async #settleUncertainLaunch(
    tool: ToolRecord,
    error: unknown
  ): Promise<ToolLaunchOutcome> {
    try {
      const snapshot = await this.#snapshot();
      const matching = snapshot.panes.find(
        (pane) =>
          pane.label === tool.label || pane.pane_id === tool.returnedPaneId
      );
      if (matching) {
        tool.resource = resourceOf(matching);
        tool.phase = 'running';
        this.#emitPhase(tool, 'running');
        return { phase: 'running', toolId: tool.toolId };
      }
    } catch {
      // The uncertain result below is authoritative until later reconciliation.
    }
    tool.phase = 'indeterminate';
    this.#launchesAllowed = false;
    this.#emit({
      type: 'indeterminate',
      toolId: tool.toolId,
      kind: tool.kind,
      message: `Herdr lost the launch result. The command may already have run. Acknowledge this risk before a manual retry. ${diagnostic(error)}`,
    });
    return { phase: 'indeterminate', toolId: tool.toolId };
  }

  async #connectSubscription(initial: boolean): Promise<void> {
    const socket = createConnection(this.#socketPath);
    this.#subscription = socket;
    let input = '';
    let acknowledged = false;
    const id = this.#nextId();
    const ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        socket.destroy();
        finish(new Error('events.subscribe timed out'));
      }, this.#timeoutMs);
      socket.once('error', finish);
      socket.once('close', () => {
        if (!acknowledged) {
          finish(new Error('events.subscribe connection ended'));
        }
      });
      socket.on('data', (chunk: Buffer) => {
        input += chunk.toString('utf8');
        for (;;) {
          const newline = input.indexOf('\n');
          if (newline < 0) break;
          const line = input.slice(0, newline);
          input = input.slice(newline + 1);
          if (!line) continue;
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            continue;
          }
          if (!acknowledged && isResponseFor(value, id)) {
            try {
              readResult(value);
              acknowledged = true;
              this.#subscriptionConnected = true;
              finish();
            } catch (error) {
              socket.destroy();
              finish(error);
            }
          } else if (acknowledged) {
            this.#onEvent(value);
          }
        }
      });
    });
    socket.once('connect', () => {
      socket.write(
        `${JSON.stringify({
          id,
          method: 'events.subscribe',
          params: {
            subscriptions: subscriptions.map((type) => ({ type })),
          },
        })}\n`
      );
    });
    socket.once('close', () => {
      const wasConnected = this.#subscriptionConnected;
      this.#subscriptionConnected = false;
      this.#ordinaryEventsEnabled = false;
      if (!this.#stopping && (acknowledged || wasConnected)) {
        this.#launchesAllowed = false;
        this.#emit({
          type: 'lifecycleDegraded',
          message:
            'Herdr lifecycle tracking disconnected. New launches are disabled while review reconnects.',
        });
        this.#scheduleReconnect();
      }
    });
    await ready;
    if (initial) {
      this.#ordinaryEventsEnabled = true;
    } else {
      try {
        const snapshot = await this.#snapshot();
        this.#reconcile(snapshot, true);
      } catch (error) {
        this.#subscriptionConnected = false;
        socket.destroy();
        throw error;
      }
      this.#ordinaryEventsEnabled = true;
      this.#refreshLaunchInterlock();
      this.#emit({
        type: 'lifecycleRestored',
        message: 'Herdr lifecycle tracking is restored.',
      });
    }
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTask) return;
    this.#reconnectTask = (async () => {
      while (!this.#stopping && !this.#subscriptionConnected) {
        try {
          await this.#connectSubscription(false);
        } catch {
          await Bun.sleep(50);
        }
      }
    })().finally(() => {
      this.#reconnectTask = undefined;
    });
  }

  #onEvent(value: unknown): void {
    if (!isRecord(value)) return;
    const event = typeof value.event === 'string' ? value.event : '';
    const data = isRecord(value.data) ? value.data : undefined;
    if (!data) return;
    if (event === 'pane_created' && isRecord(data.pane)) {
      const pane = parsePane(data.pane);
      const tool = [...this.#tools.values()].find(
        (candidate) => candidate.label === pane.label
      );
      if (tool && tool.phase !== 'ended' && !tool.resource) {
        tool.returnedPaneId = pane.pane_id;
        void this.#baselineLateCreation(tool, pane.pane_id);
      }
      return;
    }
    if (event === 'pane_moved' && isRecord(data.pane)) {
      const pane = parsePane(data.pane);
      if (pane.terminal_id === this.#queue.terminalId)
        this.#queue = resourceOf(pane);
      const tool = [...this.#tools.values()].find(
        (candidate) => candidate.resource?.terminalId === pane.terminal_id
      );
      if (tool) tool.resource = resourceOf(pane);
      return;
    }
    if (event === 'pane_exited') {
      if (!this.#ordinaryEventsEnabled) return;
      const paneId =
        typeof data.pane_id === 'string' ? data.pane_id : undefined;
      const tool = [...this.#tools.values()].find(
        (candidate) =>
          candidate.phase !== 'ended' && candidate.resource?.paneId === paneId
      );
      if (!tool) {
        if (
          paneId &&
          [...this.#tools.values()].some(
            (candidate) => candidate.phase === 'launching'
          )
        ) {
          this.#unmatchedExitPaneIds.add(paneId);
        }
        return;
      }
      tool.ordinaryExitSeen = true;
      tool.phase = 'ended';
      this.#refreshLaunchInterlock();
      this.#emitPhase(tool, 'ended');
      void this.#restoreQueueFocus(tool.toolId);
      return;
    }
    if (
      event === 'pane_closed' ||
      event === 'tab_closed' ||
      event === 'workspace_closed'
    ) {
      void this.#snapshot()
        .then((snapshot) => this.#reconcile(snapshot, false))
        .catch(() => undefined);
    }
  }

  async #baselineLateCreation(tool: ToolRecord, paneId: string): Promise<void> {
    try {
      const pane = paneFromResult(
        await this.#request('pane.get', { pane_id: paneId })
      );
      await this.#confirmRunning(tool, pane);
    } catch (error) {
      if (error instanceof RpcError && error.code === 'pane_not_found') {
        this.#endBeforeBaseline(tool);
        return;
      }
      await this.#retryPaneGet(tool, paneId, error);
    }
  }

  #refreshLaunchInterlock(): void {
    this.#launchesAllowed =
      !this.#stopping &&
      this.#subscriptionConnected &&
      ![...this.#tools.values()].some(
        (tool) => tool.phase === 'indeterminate' && !tool.acknowledged
      );
  }

  async #restoreQueueFocus(toolId: ToolId): Promise<void> {
    try {
      await this.#request('pane.focus', { pane_id: this.#queue.paneId });
    } catch (error) {
      this.#emit({
        type: 'controlFailure',
        toolId,
        message: `Herdr could not focus the Review Queue pane: ${diagnostic(error)}`,
        ...(error instanceof RpcError ? { code: error.code } : {}),
      });
      if (error instanceof RpcError && error.code === 'pane_not_found') {
        try {
          this.#reconcile(await this.#snapshot(), false);
        } catch {
          // Focus remains best effort. Do not retry it for this exit.
        }
      }
    }
  }

  #reconcile(snapshot: Snapshot, disconnected: boolean): void {
    const queue = snapshot.panes.find(
      (pane) => pane.terminal_id === this.#queue.terminalId
    );
    if (queue) this.#queue = resourceOf(queue);
    for (const tool of this.#tools.values()) {
      if (!tool.resource) {
        const matching = snapshot.panes.find(
          (pane) => pane.label === tool.label
        );
        if (matching) {
          tool.resource = resourceOf(matching);
          if (tool.phase !== 'ended') {
            tool.phase = 'running';
            this.#refreshLaunchInterlock();
            this.#emitPhase(tool, 'running');
          }
        }
        continue;
      }
      const { terminalId } = tool.resource;
      const pane = snapshot.panes.find(
        (candidate) => candidate.terminal_id === terminalId
      );
      if (pane) {
        tool.resource = resourceOf(pane);
      } else if (tool.phase !== 'ended') {
        tool.phase = 'ended';
        this.#refreshLaunchInterlock();
        this.#emitPhase(tool, 'ended');
        if (!disconnected && tool.ordinaryExitSeen) {
          void this.#restoreQueueFocus(tool.toolId);
        }
      }
    }
  }

  async #snapshot(): Promise<Snapshot> {
    const result = await this.#request('session.snapshot', {});
    const snapshot = recordField(result, 'snapshot');
    const panes = arrayField(snapshot, 'panes').map(parsePane);
    const workspaces = arrayField(snapshot, 'workspaces').map((value) => ({
      workspace_id: stringField(value, 'workspace_id'),
    }));
    const tabs = arrayField(snapshot, 'tabs').map((value) => ({
      tab_id: stringField(value, 'tab_id'),
      workspace_id: stringField(value, 'workspace_id'),
    }));
    return {
      version: stringField(snapshot, 'version'),
      protocol: numberField(snapshot, 'protocol'),
      panes,
      workspaces,
      tabs,
    };
  }

  #request(
    method: string,
    params: Record<string, unknown>,
    timed = true
  ): Promise<unknown> {
    const id = this.#nextId();
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.#socketPath);
      let input = '';
      let settled = false;
      const timer = timed
        ? setTimeout(
            () => finish(new Error(`${method} timed out`)),
            this.#timeoutMs
          )
        : undefined;
      const finish = (error?: unknown, result?: unknown) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(result);
      };
      socket.once('connect', () => {
        const request = { id, method, params } satisfies RpcRequest;
        socket.write(`${JSON.stringify(request)}\n`);
      });
      socket.once('error', finish);
      socket.once('end', () => finish(new Error(`${method} connection ended`)));
      socket.on('data', (chunk) => {
        input += chunk.toString('utf8');
        const newline = input.indexOf('\n');
        if (newline < 0) return;
        try {
          const response: unknown = JSON.parse(input.slice(0, newline));
          if (!isResponseFor(response, id)) {
            finish(new Error(`${method} returned a mismatched response`));
            return;
          }
          finish(undefined, readResult(response));
        } catch (error) {
          finish(error);
        }
      });
    });
  }

  #nextId(): string {
    this.#requestNumber += 1;
    return `review_${this.#requestNumber}`;
  }

  #emitPhase(tool: ToolRecord, phase: 'running' | 'ended'): void {
    this.#emit({
      type: 'phaseChanged',
      toolId: tool.toolId,
      kind: tool.kind,
      phase,
    });
  }

  #emit(notice: ToolNotice): void {
    for (const listener of this.#listeners) listener(notice);
  }
}

class RpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function readContext(environment: Readonly<NodeJS.ProcessEnv>) {
  if (environment.HERDR_ENV !== '1') {
    throw new HerdrStartupError(
      'Herdr v0.8.2 is required. Start Herdr and run review inside a Herdr pane.'
    );
  }
  return {
    socketPath: requiredContextValue(
      'HERDR_SOCKET_PATH',
      environment.HERDR_SOCKET_PATH
    ),
    workspaceId: requiredContextValue(
      'HERDR_WORKSPACE_ID',
      environment.HERDR_WORKSPACE_ID
    ),
    tabId: requiredContextValue('HERDR_TAB_ID', environment.HERDR_TAB_ID),
    paneId: requiredContextValue('HERDR_PANE_ID', environment.HERDR_PANE_ID),
  };
}

function requiredContextValue(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new HerdrStartupError(
      `Herdr did not provide ${name}. Update Herdr and run review inside a Herdr pane.`
    );
  }
  return value;
}

function createToolRecord(
  toolId: ToolId,
  kind: ToolKind,
  label: string
): ToolRecord {
  return {
    toolId,
    kind,
    label,
    phase: 'launching',
    acknowledged: false,
    ordinaryExitSeen: false,
  };
}

function childEnvironment(
  inherited: Readonly<NodeJS.ProcessEnv>,
  kind: ToolKind,
  pullRequest: PullRequestSummary,
  toolId: ToolId
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
  environment.REVIEW_TOOL_ID = toolId;
  if (kind === 'reviewCommand') {
    Object.assign(environment, {
      REVIEW_PR_URL: pullRequest.url,
      REVIEW_PR_REPOSITORY: pullRequest.repository,
      REVIEW_PR_NUMBER: String(pullRequest.number),
      REVIEW_PR_TITLE: pullRequest.title,
      REVIEW_PR_AUTHOR: pullRequest.author,
      REVIEW_PR_IS_DRAFT: String(pullRequest.isDraft),
      REVIEW_PR_STATE: pullRequest.state,
      REVIEW_PR_CREATED_AT: pullRequest.createdAt,
      REVIEW_PR_UPDATED_AT: pullRequest.updatedAt,
    });
  }
  return environment;
}

async function isInsideRepository(start: string): Promise<boolean> {
  let current = start;
  for (;;) {
    for (const marker of ['.git', '.jj']) {
      try {
        await access(join(current, marker));
        return true;
      } catch {
        // Continue the ancestor walk.
      }
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function toolLabel(
  kind: ToolKind,
  pullRequest: PullRequestSummary,
  toolId: ToolId
): string {
  const name = kind === 'lumen' ? 'Lumen' : 'Review Command';
  return `${name} ${pullRequest.repository}#${pullRequest.number} ${toolId}`;
}

function rejected(
  kind: ToolFailure['kind'],
  message: string,
  code?: string
): ToolLaunchOutcome {
  return {
    phase: 'rejected',
    failure: { kind, message, ...(code ? { code } : {}) },
  };
}

function paneFromResult(result: unknown): Pane {
  return parsePane(recordField(result, 'pane'));
}

function parsePane(value: unknown): Pane {
  if (!isRecord(value))
    throw new Error('Herdr returned incompatible pane data');
  return {
    pane_id: stringField(value, 'pane_id'),
    terminal_id: stringField(value, 'terminal_id'),
    workspace_id: stringField(value, 'workspace_id'),
    tab_id: stringField(value, 'tab_id'),
    ...(typeof value.label === 'string' ? { label: value.label } : {}),
  };
}

function resourceOf(pane: Pane): Resource {
  return {
    paneId: pane.pane_id,
    terminalId: pane.terminal_id,
    tabId: pane.tab_id,
    workspaceId: pane.workspace_id,
  };
}

function readResult(value: unknown): unknown {
  if (!isRecord(value)) throw new Error('Herdr returned invalid JSON data');
  if (isRecord(value.error)) {
    throw new RpcError(
      typeof value.error.code === 'string' ? value.error.code : 'unknown',
      typeof value.error.message === 'string'
        ? value.error.message
        : 'unknown Herdr error'
    );
  }
  if (!('result' in value)) throw new Error('Herdr response has no result');
  return value.result;
}

function isResponseFor(value: unknown, id: string): value is RpcResponse {
  return isRecord(value) && value.id === id;
}

function recordField(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[field])) {
    throw new Error(`Herdr response has no ${field}`);
  }
  return value[field];
}

function arrayField(value: unknown, field: string): unknown[] {
  if (!isRecord(value) || !Array.isArray(value[field])) {
    throw new Error(`Herdr response has no ${field}`);
  }
  return value[field];
}

function stringField(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== 'string') {
    throw new Error(`Herdr response has invalid ${field}`);
  }
  return value[field];
}

function numberField(value: unknown, field: string): number {
  if (!isRecord(value) || typeof value[field] !== 'number') {
    throw new Error(`Herdr response has invalid ${field}`);
  }
  return value[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
