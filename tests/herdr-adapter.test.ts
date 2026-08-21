/* eslint-disable for-ai/no-constant-assertion -- Contract assertions verify captured mutable socket interactions. */
/* eslint-disable for-ai/no-standalone-class -- The fake server owns mutable socket and resource state. */
/* eslint-disable for-ai/no-bare-wrapper -- Socket callbacks adapt callback signatures. */
/* eslint-disable no-restricted-syntax -- Explicit contract types make fake protocol records clear. */
/* eslint-disable @typescript-eslint/consistent-type-assertions -- The fake decodes controlled test messages. */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- Prior assertions establish fake requests. */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Bun matchers intentionally return dynamic asymmetric values. */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createHerdrToolTabs,
  HerdrStartupError,
} from '../src/tools/herdr-adapter.ts';
import type { PullRequestSummary } from '../src/domain/pull-request.ts';

const pullRequest: PullRequestSummary = {
  url: 'https://github.example/acme/widgets/pull/42',
  repository: 'acme/widgets',
  number: 42,
  title: 'Keep exact process data',
  author: 'octocat',
  isDraft: false,
  state: 'open',
  createdAt: '2026-08-20T10:00:00Z',
  updatedAt: '2026-08-21T11:00:00Z',
};

let directory: string | undefined;
let server: FakeHerdr | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('Herdr Tool Tabs adapter contract', () => {
  test('rejects startup outside a complete Herdr pane context', async () => {
    await expect(
      createHerdrToolTabs({
        reviewCommand: 'pi',
        workingDirectory: '/tmp',
        environment: {},
        herdrEnvironment: {},
      })
    ).rejects.toThrow('Start Herdr');
  });

  test('reports an actionable Herdr startup error when event subscription fails', async () => {
    ({ directory, server } = await startFake());
    server.rejectSubscriptions = true;

    const startup = createTools(directory, server);
    await expect(startup).rejects.toBeInstanceOf(HerdrStartupError);
    await expect(startup).rejects.toThrow('Start Herdr');
  });

  test('launches an opaque Review Command as one direct-process Tool Tab', async () => {
    ({ directory, server } = await startFake());
    const inherited = { PATH: '/usr/bin', KEEP: 'yes', REVIEW_PR_TITLE: 'old' };
    const tools = await createHerdrToolTabs({
      reviewCommand: 'pi --prompt "Review $REVIEW_PR_URL" | tee review.txt',
      workingDirectory: directory,
      environment: inherited,
      herdrEnvironment: herdrEnvironment(server.socketPath),
    });

    const outcome = await tools.launch({
      kind: 'reviewCommand',
      pullRequest,
    });

    expect(outcome.phase).toBe('running');
    if (outcome.phase === 'rejected') throw new Error(outcome.failure.message);
    const toolId = outcome.toolId;
    const apply = server.requests.find(
      (request) => request.method === 'layout.apply'
    );
    expect(apply?.params).toMatchObject({
      workspace_id: 'w1',
      focus: true,
      root: {
        type: 'pane',
        cwd: directory,
        command: [
          '/bin/sh',
          '-c',
          'pi --prompt "Review $REVIEW_PR_URL" | tee review.txt',
        ],
        env: {
          PATH: '/usr/bin',
          KEEP: 'yes',
          REVIEW_PR_URL: pullRequest.url,
          REVIEW_PR_REPOSITORY: pullRequest.repository,
          REVIEW_PR_NUMBER: '42',
          REVIEW_PR_TITLE: pullRequest.title,
          REVIEW_PR_AUTHOR: pullRequest.author,
          REVIEW_PR_IS_DRAFT: 'false',
          REVIEW_PR_STATE: pullRequest.state,
          REVIEW_PR_CREATED_AT: pullRequest.createdAt,
          REVIEW_PR_UPDATED_AT: pullRequest.updatedAt,
          REVIEW_TOOL_ID: toolId,
        },
      },
    });
    expect((apply?.params.root as Record<string, unknown>).label).toContain(
      toolId
    );
    expect(apply?.params.tab_label).toContain('Review Command acme/widgets#42');
    expect(inherited).toEqual({
      PATH: '/usr/bin',
      KEEP: 'yes',
      REVIEW_PR_TITLE: 'old',
    });

    await tools.shutdown('quit');
  });

  test('launches fixed Lumen argv only inside a repository without Review Command variables', async () => {
    ({ directory, server } = await startFake());
    const outside = join(directory, 'outside');
    await mkdir(outside);
    const tools = await createHerdrToolTabs({
      reviewCommand: 'ignored',
      workingDirectory: outside,
      environment: { KEEP: 'yes', REVIEW_PR_URL: 'inherited' },
      herdrEnvironment: herdrEnvironment(server.socketPath),
    });

    expect(await tools.launch({ kind: 'lumen', pullRequest })).toEqual({
      phase: 'rejected',
      failure: {
        kind: 'precondition',
        message:
          'lumen diff requires review to start inside a Git or Jujutsu repository.',
      },
    });
    expect(
      server.requests.some((request) => request.method === 'layout.apply')
    ).toBe(false);

    await mkdir(join(directory, '.git'));
    const outcome = await tools.launch({ kind: 'lumen', pullRequest });
    expect(outcome.phase).toBe('running');
    const apply = server.requests.find(
      (request) => request.method === 'layout.apply'
    );
    expect(apply?.params).toMatchObject({
      root: {
        command: ['lumen', 'diff', pullRequest.url],
        env: { KEEP: 'yes', REVIEW_PR_URL: 'inherited' },
      },
    });
    const env = (apply?.params.root as { env: Record<string, string> }).env;
    expect(env.REVIEW_TOOL_ID).toBe((outcome as { toolId: string }).toolId);
    expect(env.REVIEW_PR_NUMBER).toBeUndefined();

    await tools.shutdown('quit');
  });

  test('restores the Review Queue with one pane focus request after an ordinary exit', async () => {
    ({ directory, server } = await startFake());
    const tools = await createTools(directory, server);
    const notices: unknown[] = [];
    tools.subscribe((notice) => notices.push(notice));
    const outcome = await tools.launch({ kind: 'reviewCommand', pullRequest });
    expect(outcome.phase).toBe('running');

    server.exit('w1:p2');
    await waitFor(() =>
      server!.requests.some((request) => request.method === 'pane.focus')
    );

    expect(
      server.requests.filter((request) => request.method === 'pane.focus')
    ).toEqual([expect.objectContaining({ params: { pane_id: 'w1:p1' } })]);
    expect(notices).toContainEqual(
      expect.objectContaining({
        type: 'phaseChanged',
        toolId: (outcome as { toolId: string }).toolId,
        phase: 'ended',
      })
    );
    await tools.shutdown('quit');
  });

  test('reconciles stable terminal IDs after subscription disconnect before later exit', async () => {
    ({ directory, server } = await startFake());
    const tools = await createTools(directory, server);
    const outcome = await tools.launch({ kind: 'reviewCommand', pullRequest });
    expect(outcome.phase).toBe('running');

    server.movePane('w1:p2', 'w2:p9', 'w2:t4', 'w2');
    server.disconnectSubscriptions();
    await waitFor(
      () =>
        server!.requests.filter(
          (request) => request.method === 'events.subscribe'
        ).length === 2
    );
    await waitFor(
      () =>
        server!.requests.filter(
          (request) => request.method === 'session.snapshot'
        ).length >= 3
    );
    server.exit('w2:p9');
    await waitFor(() =>
      server!.requests.some((request) => request.method === 'pane.focus')
    );

    expect(
      server.requests.filter((request) => request.method === 'pane.focus')
    ).toHaveLength(1);
    await tools.shutdown('quit');
  });

  test('disables launches and reports confirmed Review Queue pane closure', async () => {
    ({ directory, server } = await startFake());
    const tools = await createTools(directory, server);
    const snapshotCount = server.requests.filter(
      (request) => request.method === 'session.snapshot'
    ).length;

    server.closeReviewQueuePane();
    await waitFor(
      () =>
        server!.requests.filter(
          (request) => request.method === 'session.snapshot'
        ).length > snapshotCount
    );
    const notices: unknown[] = [];
    tools.subscribe((notice) => notices.push(notice));

    expect(
      await tools.launch({ kind: 'reviewCommand', pullRequest })
    ).toMatchObject({
      phase: 'rejected',
      failure: { kind: 'precondition' },
    });
    expect(notices).toContainEqual({
      type: 'reviewQueueClosed',
      message: 'The Review Queue pane no longer exists in Herdr.',
    });
  });

  test('reports an uncertain launch, requires acknowledgement, and keeps watching for ownership', async () => {
    ({ directory, server } = await startFake());
    server.disconnectNextLayout = true;
    const tools = await createTools(directory, server);
    const first = await tools.launch({ kind: 'reviewCommand', pullRequest });
    expect(first.phase).toBe('indeterminate');

    expect(
      await tools.launch({ kind: 'reviewCommand', pullRequest })
    ).toMatchObject({
      phase: 'rejected',
      failure: { kind: 'precondition' },
    });
    tools.acknowledgeIndeterminateLaunch((first as { toolId: string }).toolId);
    const second = await tools.launch({ kind: 'reviewCommand', pullRequest });
    expect(second.phase).toBe('running');

    const firstApply = server.requests.find(
      (request) => request.method === 'layout.apply'
    )!;
    const firstLabel = (firstApply.params.root as { label: string }).label;
    server.createLatePane('w1:p8', 'term-late', 'w1:t8', firstLabel);
    await waitFor(() =>
      server!.requests.some(
        (request) =>
          request.method === 'pane.get' && request.params.pane_id === 'w1:p8'
      )
    );

    expect(await tools.shutdown('quit')).toEqual({ ok: true });
    expect(
      server.requests.some(
        (request) =>
          request.method === 'pane.close' || request.method === 'tab.close'
      )
    ).toBe(false);
  });
});

type Request = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

class FakeHerdr {
  readonly requests: Request[] = [];
  readonly socketPath: string;
  disconnectNextLayout = false;
  rejectSubscriptions = false;
  readonly #server: Server;
  readonly #sockets = new Set<Socket>();
  readonly #subscriptions = new Set<Socket>();
  readonly #panes = new Map<string, ReturnType<typeof pane>>([
    ['w1:p1', pane('w1:p1', 'term-queue', 'w1:t1')],
  ]);

  constructor(socketPath: string, nodeServer: Server) {
    this.socketPath = socketPath;
    this.#server = nodeServer;
  }

  accept(socket: Socket): void {
    this.#sockets.add(socket);
    socket.on('close', () => {
      this.#sockets.delete(socket);
      this.#subscriptions.delete(socket);
    });
    let input = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      input += chunk;
      for (;;) {
        const newline = input.indexOf('\n');
        if (newline < 0) return;
        const line = input.slice(0, newline);
        input = input.slice(newline + 1);
        if (line) this.handle(socket, JSON.parse(line) as Request);
      }
    });
  }

  handle(socket: Socket, request: Request): void {
    this.requests.push(request);
    if (request.method === 'session.snapshot') {
      this.reply(socket, request.id, {
        type: 'session_snapshot',
        snapshot: snapshot([...this.#panes.values()]),
      });
      return;
    }
    if (request.method === 'events.subscribe') {
      if (this.rejectSubscriptions) {
        socket.write(
          `${JSON.stringify({ id: request.id, error: { code: 'subscription_failed', message: 'subscription unavailable' } })}\n`
        );
        return;
      }
      this.#subscriptions.add(socket);
      this.reply(socket, request.id, { type: 'subscription_started' });
      return;
    }
    if (request.method === 'layout.apply') {
      if (this.disconnectNextLayout) {
        this.disconnectNextLayout = false;
        socket.destroy();
        return;
      }
      const label = (request.params.root as { label: string }).label;
      const next = this.#panes.has('w1:p2') ? 'w1:p3' : 'w1:p2';
      const created = {
        ...pane(next, `term-${next}`, `w1:t${next.slice(-1)}`),
        label,
      };
      this.#panes.set(next, created);
      this.reply(socket, request.id, {
        type: 'layout_apply',
        layout: {
          workspace_id: 'w1',
          tab_id: created.tab_id,
          zoomed: false,
          focused_pane_id: next,
          root: { type: 'pane', pane_id: next },
        },
      });
      return;
    }
    if (request.method === 'pane.get') {
      const found = this.#panes.get(String(request.params.pane_id));
      if (!found) {
        socket.write(
          `${JSON.stringify({ id: request.id, error: { code: 'pane_not_found', message: 'pane not found' } })}\n`
        );
        return;
      }
      this.reply(socket, request.id, { type: 'pane_info', pane: found });
      return;
    }
    if (request.method === 'pane.close') {
      this.#panes.delete(String(request.params.pane_id));
      this.reply(socket, request.id, { type: 'ok' });
      return;
    }
    this.reply(socket, request.id, { type: 'ok' });
  }

  reply(socket: Socket, id: string, result: unknown): void {
    socket.write(`${JSON.stringify({ id, result })}\n`);
  }

  exit(paneId: string): void {
    const found = this.#panes.get(paneId);
    if (!found) throw new Error(`Unknown pane ${paneId}`);
    this.#panes.delete(paneId);
    this.emit('pane_exited', {
      type: 'pane_exited',
      pane_id: paneId,
      workspace_id: found.workspace_id,
    });
  }

  movePane(
    oldId: string,
    paneId: string,
    tabId: string,
    workspaceId: string
  ): void {
    const found = this.#panes.get(oldId);
    if (!found) throw new Error(`Unknown pane ${oldId}`);
    this.#panes.delete(oldId);
    this.#panes.set(paneId, {
      ...found,
      pane_id: paneId,
      tab_id: tabId,
      workspace_id: workspaceId,
    });
  }

  createLatePane(
    paneId: string,
    terminalId: string,
    tabId: string,
    label: string
  ): void {
    const created = { ...pane(paneId, terminalId, tabId), label };
    this.#panes.set(paneId, created);
    this.emit('pane_created', { type: 'pane_created', pane: created });
  }

  closeReviewQueuePane(): void {
    this.#panes.delete('w1:p1');
    this.emit('pane_closed', {
      type: 'pane_closed',
      pane_id: 'w1:p1',
      workspace_id: 'w1',
    });
  }

  disconnectSubscriptions(): void {
    for (const socket of this.#subscriptions) socket.destroy();
  }

  emit(event: string, data: unknown): void {
    for (const socket of this.#subscriptions) {
      socket.write(`${JSON.stringify({ event, data })}\n`);
    }
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}

async function startFake(): Promise<{
  directory: string;
  server: FakeHerdr;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'review-herdr-'));
  const socketPath = join(directory, 'herdr.sock');
  const nodeServer = createServer();
  const fake = new FakeHerdr(socketPath, nodeServer);
  nodeServer.on('connection', fake.accept.bind(fake));
  await new Promise<void>((resolve, reject) => {
    nodeServer.once('error', reject);
    nodeServer.listen(socketPath, resolve);
  });
  return { directory, server: fake };
}

function snapshot(panes: ReturnType<typeof pane>[]) {
  const workspaceIds = [...new Set(panes.map((item) => item.workspace_id))];
  const tabs = [
    ...new Map(
      panes.map((item) => [
        item.tab_id,
        { tab_id: item.tab_id, workspace_id: item.workspace_id },
      ])
    ).values(),
  ];
  return {
    version: '0.8.2',
    protocol: 20,
    focused_workspace_id: 'w1',
    focused_tab_id: 'w1:t1',
    focused_pane_id: 'w1:p1',
    workspaces: workspaceIds.map((workspace_id) => ({ workspace_id })),
    tabs,
    panes,
    layouts: [],
    agents: [],
  };
}

function pane(
  paneId: string,
  terminalId: string,
  tabId: string,
  workspaceId = 'w1'
) {
  return {
    pane_id: paneId,
    terminal_id: terminalId,
    workspace_id: workspaceId,
    tab_id: tabId,
    focused: paneId === 'w1:p1',
    agent_status: 'idle',
    revision: 0,
  };
}

async function createTools(directory: string, fake: FakeHerdr) {
  return createHerdrToolTabs({
    reviewCommand: 'pi "$REVIEW_PR_URL"',
    workingDirectory: directory,
    environment: { KEEP: 'yes' },
    herdrEnvironment: herdrEnvironment(fake.socketPath),
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for fake Herdr interaction');
    await Bun.sleep(10);
  }
}

function herdrEnvironment(socketPath: string): NodeJS.ProcessEnv {
  return {
    HERDR_ENV: '1',
    HERDR_SOCKET_PATH: socketPath,
    HERDR_WORKSPACE_ID: 'w1',
    HERDR_TAB_ID: 'w1:t1',
    HERDR_PANE_ID: 'w1:p1',
  };
}
