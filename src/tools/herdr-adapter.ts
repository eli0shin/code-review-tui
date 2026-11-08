import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PullRequestSummary } from '../domain/pull-request.ts';
import type {
  Herdr,
  HerdrFailure,
  HerdrOperation,
  HerdrResult,
} from './types.ts';

type AdapterOptions = {
  readonly reviewCommand: string;
  readonly diffCommand?: string;
  readonly workingDirectory: string;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly herdrEnvironment?: Readonly<NodeJS.ProcessEnv>;
};

type HerdrContext = {
  readonly workspaceId: string;
  readonly reviewQueueTabId: string;
};

type TabAction =
  | { readonly kind: 'lumen' }
  | {
      readonly kind: 'command';
      readonly name: 'Diff' | 'Review';
      readonly command: string;
    };

type ProcessOutput = {
  readonly stdout: string;
  readonly stderr: string;
};

// Herdr (the TUI) and the Herdr app are separate products. In the app, the
// terminals run in herdr-core and `herdr-app` arranges them in tabs.
type HerdrProgram = 'herdr' | 'herdr-app';

type OpenTab = (
  action: TabAction,
  pullRequest: PullRequestSummary
) => Promise<HerdrResult>;

export function createHerdrCliAdapter(options: AdapterOptions): Herdr {
  const herdrEnvironment = options.herdrEnvironment ?? process.env;
  const open = tabOpener(options, herdrEnvironment);

  const diff = (
    options.diffCommand === undefined
      ? { kind: 'lumen' }
      : { kind: 'command', name: 'Diff', command: options.diffCommand }
  ) satisfies TabAction;
  const review = {
    kind: 'command',
    name: 'Review',
    command: options.reviewCommand,
  } satisfies TabAction;

  return {
    openDiff: (pullRequest) => open(diff, pullRequest),
    openReviewCommand: (pullRequest) => open(review, pullRequest),
  };
}

function tabOpener(
  options: AdapterOptions,
  herdrEnvironment: Readonly<NodeJS.ProcessEnv>
): OpenTab {
  if (herdrEnvironment.HERDR_ENV === '1') {
    const context = readContext(herdrEnvironment);
    return (action, pullRequest) =>
      openHerdrTab(options, herdrEnvironment, context, action, pullRequest);
  }
  const terminal = herdrEnvironment.HC_TERMINAL_ID?.trim();
  if (terminal) {
    return (action, pullRequest) =>
      openHerdrAppTab(options, herdrEnvironment, terminal, action, pullRequest);
  }
  throw new Error(
    'Start Herdr or the Herdr app, then run review inside one of its panes.'
  );
}

async function openHerdrTab(
  options: AdapterOptions,
  herdrEnvironment: Readonly<NodeJS.ProcessEnv>,
  context: HerdrContext,
  action: TabAction,
  pullRequest: PullRequestSummary
): Promise<HerdrResult> {
  if (
    action.kind === 'lumen' &&
    !(await isInsideRepository(options.workingDirectory))
  ) {
    return failed(
      'createTab',
      'lumen diff requires review to start inside a Git or Jujutsu repository.'
    );
  }

  const environment = childEnvironment(
    options.environment,
    action,
    pullRequest
  );
  const create = await runHerdr(
    [
      'tab',
      'create',
      '--workspace',
      context.workspaceId,
      '--cwd',
      options.workingDirectory,
      '--label',
      tabLabel(action, pullRequest),
      '--no-focus',
      ...environmentArguments(environment),
    ],
    herdrEnvironment,
    'createTab'
  );
  if (!create.ok) return create;

  const created = parseCreatedTab(create.value);
  if (!created.ok) return created;

  const cleanup = `herdr tab focus ${shellQuote(context.reviewQueueTabId)}; herdr tab close ${shellQuote(created.value.tabId)}`;
  const script = tabScript(action, pullRequest, cleanup);
  const command =
    action.kind === 'lumen' ? `/bin/sh -c ${shellQuote(script)}` : script;
  const run = await runHerdr(
    ['pane', 'run', created.value.paneId, command],
    herdrEnvironment,
    'runCommand'
  );
  if (!run.ok) return run;

  const focus = await runHerdr(
    ['tab', 'focus', created.value.tabId],
    herdrEnvironment,
    'focusTab'
  );
  return focus.ok ? { ok: true } : focus;
}

// The Herdr app tab runs `review`'s environment and the launched command
// through `/usr/bin/env` and `/bin/sh`, then puts focus back on the Review
// Queue and ends its own terminal, which closes the tab.
async function openHerdrAppTab(
  options: AdapterOptions,
  herdrEnvironment: Readonly<NodeJS.ProcessEnv>,
  reviewQueueTerminal: string,
  action: TabAction,
  pullRequest: PullRequestSummary
): Promise<HerdrResult> {
  if (
    action.kind === 'lumen' &&
    !(await isInsideRepository(options.workingDirectory))
  ) {
    return failed(
      'createTab',
      'lumen diff requires review to start inside a Git or Jujutsu repository.'
    );
  }

  const listed = await runHerdr(
    ['ls'],
    herdrEnvironment,
    'createTab',
    'herdr-app'
  );
  if (!listed.ok) return listed;
  const space = findTerminalSpace(listed.value, reviewQueueTerminal);
  if (!space.ok) return space;

  // herdr-core gives each terminal its own HC_* identity.
  const environment = Object.entries(
    childEnvironment(options.environment, action, pullRequest)
  ).filter(([name]) => !name.startsWith('HC_'));
  const cleanup = `herdr-app do pane.focus ${shellQuote(JSON.stringify({ terminal: reviewQueueTerminal }))}; herdr-app do terminal.kill "{\\"terminal\\":\\"$HC_TERMINAL_ID\\"}"`;
  const created = await runHerdr(
    [
      'do',
      'tab.new',
      JSON.stringify({
        space: space.value,
        name: tabLabel(action, pullRequest),
        folder: options.workingDirectory,
        argv: [
          '/usr/bin/env',
          ...environment.map(([name, value]) => `${name}=${value}`),
          '/bin/sh',
          '-c',
          tabScript(action, pullRequest, cleanup),
        ],
      }),
    ],
    herdrEnvironment,
    'createTab',
    'herdr-app'
  );
  return created.ok ? { ok: true } : created;
}

function findTerminalSpace(
  output: ProcessOutput,
  terminal: string
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly failure: HerdrFailure } {
  const parsed = parseJson(output, 'Herdr app CLI');
  if (!parsed.ok) return parsed;
  const spaces =
    isRecord(parsed.value) && Array.isArray(parsed.value.spaces)
      ? parsed.value.spaces
      : [];
  for (const space of spaces) {
    // Spaces on other machines hold their terminals there.
    if (!isRecord(space) || space.machine || typeof space.id !== 'string') {
      continue;
    }
    const tabs = Array.isArray(space.tabs) ? space.tabs : [];
    const shown = tabs.some(
      (tab) =>
        isRecord(tab) &&
        Array.isArray(tab.terminals) &&
        tab.terminals.some(
          (candidate) => isRecord(candidate) && candidate.terminal === terminal
        )
    );
    if (shown) return { ok: true, value: space.id };
  }
  return failed(
    'createTab',
    'The Herdr app window does not show this terminal. Run review in a Herdr app tab on this computer.',
    undefined,
    output.stderr
  );
}

async function runHerdr(
  arguments_: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
  operation: HerdrOperation,
  program: HerdrProgram = 'herdr'
): Promise<
  | { readonly ok: true; readonly value: ProcessOutput }
  | { readonly ok: false; readonly failure: HerdrFailure }
> {
  const cli = program === 'herdr' ? 'Herdr CLI' : 'Herdr app CLI';
  const subprocess = spawn(program, [...arguments_], {
    env: { ...environment },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  subprocess.stdout.setEncoding('utf8');
  subprocess.stderr.setEncoding('utf8');
  subprocess.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  subprocess.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const outcome = await new Promise<
    | { readonly kind: 'error'; readonly message: string }
    | { readonly kind: 'close'; readonly exitCode: number | null }
  >((resolve) => {
    subprocess.once('error', (error) => {
      resolve({ kind: 'error', message: describeError(error) });
    });
    subprocess.once('close', (exitCode) => {
      resolve({ kind: 'close', exitCode });
    });
  });

  if (outcome.kind === 'error') {
    return failed(operation, `${cli} could not start: ${outcome.message}`);
  }
  if (outcome.exitCode !== 0) {
    return failed(
      operation,
      `${cli} failed while trying to ${operationDescription(operation)}.`,
      outcome.exitCode ?? -1,
      // `herdr-app do` reports its error as JSON on stdout.
      program === 'herdr-app' ? stderr || stdout : stderr
    );
  }
  return { ok: true, value: { stdout, stderr } };
}

function parseCreatedTab(
  output: ProcessOutput
):
  | { readonly ok: true; readonly value: { tabId: string; paneId: string } }
  | { readonly ok: false; readonly failure: HerdrFailure } {
  const parsed = parseJson(output);
  if (!parsed.ok) return parsed;

  try {
    const result = recordField(parsed.value, 'result');
    const tab = recordField(result, 'tab');
    const pane = recordField(result, 'root_pane');
    return {
      ok: true,
      value: {
        tabId: stringField(tab, 'tab_id'),
        paneId: stringField(pane, 'pane_id'),
      },
    };
  } catch (error) {
    return failed(
      'createTab',
      `Herdr CLI returned incompatible tab data: ${describeError(error)}`,
      undefined,
      output.stderr
    );
  }
}

function parseJson(
  output: ProcessOutput,
  cli = 'Herdr CLI'
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: HerdrFailure } {
  try {
    const value: unknown = JSON.parse(output.stdout);
    return { ok: true, value };
  } catch (error) {
    return failed(
      'createTab',
      `${cli} returned malformed JSON: ${describeError(error)}`,
      undefined,
      output.stderr
    );
  }
}

function readContext(environment: Readonly<NodeJS.ProcessEnv>): HerdrContext {
  if (environment.HERDR_ENV !== '1') {
    throw new Error('Start Herdr, then run review inside a Herdr pane.');
  }
  return {
    workspaceId: requiredContextValue(
      'HERDR_WORKSPACE_ID',
      environment.HERDR_WORKSPACE_ID
    ),
    reviewQueueTabId: requiredContextValue(
      'HERDR_TAB_ID',
      environment.HERDR_TAB_ID
    ),
  };
}

function requiredContextValue(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      `Herdr did not provide ${name}. Run review inside a Herdr pane.`
    );
  }
  return value;
}

function childEnvironment(
  inherited: Readonly<NodeJS.ProcessEnv>,
  action: TabAction,
  pullRequest: PullRequestSummary
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
  if (action.kind === 'command') {
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

function environmentArguments(
  environment: Readonly<Record<string, string>>
): string[] {
  return Object.entries(environment).flatMap(([name, value]) => [
    '--env',
    `${name}=${value}`,
  ]);
}

function tabLabel(action: TabAction, pullRequest: PullRequestSummary): string {
  const name = action.kind === 'lumen' ? 'Lumen' : action.name;
  return `${name} ${pullRequest.repository}#${pullRequest.number}`;
}

// The POSIX script a tab runs: the launched interaction, then its cleanup.
function tabScript(
  action: TabAction,
  pullRequest: PullRequestSummary,
  cleanup: string
): string {
  if (action.kind === 'command') {
    return `/bin/sh -c ${shellQuote(action.command)}; ${cleanup}`;
  }
  const destinationDirectory = `/tmp/review/lumen/${pullRequest.repository}`;
  const destination = `${destinationDirectory}/${pullRequest.number}.txt`;
  return `if comments=$(mktemp); then if lumen diff ${shellQuote(pullRequest.url)} >"$comments" && [ -s "$comments" ]; then mkdir -p ${shellQuote(destinationDirectory)} && mv "$comments" ${shellQuote(destination)} || rm -f "$comments"; else rm -f "$comments"; fi; fi; ${cleanup}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
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

function recordField(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[field])) {
    throw new Error(`response has no ${field}`);
  }
  return value[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return fieldValue;
}

function operationDescription(operation: HerdrOperation): string {
  switch (operation) {
    case 'createTab':
      return 'create a Herdr tab';
    case 'runCommand':
      return 'run the command in the Herdr tab';
    case 'focusTab':
      return 'focus the Herdr tab';
  }
}

function failed(
  operation: HerdrOperation,
  message: string,
  exitCode?: number,
  stderr?: string
): { readonly ok: false; readonly failure: HerdrFailure } {
  return {
    ok: false,
    failure: {
      operation,
      message,
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(stderr === undefined ? {} : { stderr }),
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
