import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
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
// herdr-frontend is another window over herdr-core with the same `ls | do`
// CLI; the frontend selection file names which of the two `review` drives.
type AppProgram = 'herdr-app' | 'herdr-frontend';
type HerdrProgram = 'herdr' | AppProgram | 'hc';

// How long herdr-frontend may take to place a new terminal in its tab.
const FRONTEND_TAB_TIMEOUT_MS = 5000;
const FRONTEND_TAB_POLL_MS = 50;

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
  // The Herdr app wins over HERDR_ENV: when Herdr launched herdr-core, the
  // app's terminals inherit Herdr's markers. Herdr panes started from an app
  // terminal inherit HC_TERMINAL_ID too, so they fall back to Herdr when the
  // window does not show that terminal.
  const terminal = herdrEnvironment.HC_TERMINAL_ID?.trim();
  if (terminal) {
    const fallback =
      herdrEnvironment.HERDR_ENV === '1'
        ? optionalContext(herdrEnvironment)
        : undefined;
    return (action, pullRequest) =>
      openHerdrAppTab(
        options,
        herdrEnvironment,
        terminal,
        action,
        pullRequest,
        fallback
      );
  }
  if (herdrEnvironment.HERDR_ENV === '1') {
    const context = readContext(herdrEnvironment);
    return (action, pullRequest) =>
      openHerdrTab(options, herdrEnvironment, context, action, pullRequest);
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
  pullRequest: PullRequestSummary,
  fallback?: HerdrContext
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

  // Read for each action, so switching apps applies without a restart.
  const app = await selectedApp(herdrEnvironment);
  const listed = await runHerdr(['ls'], herdrEnvironment, 'createTab', app);
  const space = listed.ok
    ? findTerminalSpace(listed.value, reviewQueueTerminal, app)
    : listed;
  if (!space.ok) {
    return fallback
      ? openHerdrTab(options, herdrEnvironment, fallback, action, pullRequest)
      : space;
  }

  // herdr-core gives each terminal its own HC_* identity.
  const environment = Object.entries(
    childEnvironment(options.environment, action, pullRequest)
  ).filter(([name]) => !name.startsWith('HC_'));
  const focusQueue = `${app} do ${app === 'herdr-app' ? 'pane.focus' : 'agent.focus'} ${shellQuote(JSON.stringify({ terminal: reviewQueueTerminal }))}`;
  // The Herdr app leaves a shell when the program returns, so the tab ends its
  // own terminal. A terminal `hc run` starts ends with its program.
  const cleanup =
    app === 'herdr-app'
      ? `${focusQueue}; herdr-app do terminal.kill "{\\"terminal\\":\\"$HC_TERMINAL_ID\\"}"`
      : focusQueue;
  const tab = {
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
  };
  if (app === 'herdr-frontend') {
    return openFrontendTab(herdrEnvironment, tab);
  }
  const created = await runHerdr(
    ['do', 'tab.new', JSON.stringify(tab)],
    herdrEnvironment,
    'createTab',
    'herdr-app'
  );
  return created.ok ? { ok: true } : created;
}

// herdr-frontend has no `tab.new`. herdr-core starts the terminal with the
// labels that place it in a new tab of the space, then the window names the
// tab and focuses its terminal once it shows it.
async function openFrontendTab(
  herdrEnvironment: Readonly<NodeJS.ProcessEnv>,
  tab: {
    readonly space: string;
    readonly name: string;
    readonly folder: string;
    readonly argv: readonly string[];
  }
): Promise<HerdrResult> {
  const tabId = `tb${randomUUID().replaceAll('-', '')}`;
  const run = await runHerdr(
    [
      'run',
      '--bg',
      '--keep',
      '--no-parent',
      '--json',
      '--cwd',
      tab.folder,
      '--label',
      `herdr.space=${tab.space}`,
      '--label',
      `herdr.tab=${tabId}`,
      '--',
      ...tab.argv,
    ],
    herdrEnvironment,
    'createTab',
    'hc'
  );
  if (!run.ok) return run;
  const terminal = parseStartedTerminal(run.value);
  if (!terminal.ok) return terminal;

  // A command that returns at once can end before the window places or
  // focuses its terminal; it still ran, so that is not a failure.
  const shown = await waitForFrontendTab(
    herdrEnvironment,
    tabId,
    terminal.value
  );
  if (shown === 'ended') return { ok: true };
  if (shown !== 'shown') {
    // Don't leave a command running where nothing shows it.
    await runHerdr(
      ['kill', terminal.value],
      herdrEnvironment,
      'createTab',
      'hc'
    );
    return shown;
  }

  const rename = await runHerdr(
    ['do', 'tab.rename', JSON.stringify({ id: tabId, name: tab.name })],
    herdrEnvironment,
    'createTab',
    'herdr-frontend'
  );
  const focus = rename.ok
    ? await runHerdr(
        ['do', 'agent.focus', JSON.stringify({ terminal: terminal.value })],
        herdrEnvironment,
        'focusTab',
        'herdr-frontend'
      )
    : rename;
  if (focus.ok || (await terminalEnded(herdrEnvironment, terminal.value))) {
    return { ok: true };
  }
  return focus;
}

async function waitForFrontendTab(
  herdrEnvironment: Readonly<NodeJS.ProcessEnv>,
  tabId: string,
  terminal: string
): Promise<
  'shown' | 'ended' | { readonly ok: false; readonly failure: HerdrFailure }
> {
  const deadline = Date.now() + FRONTEND_TAB_TIMEOUT_MS;
  for (;;) {
    const listed = await runHerdr(
      ['ls'],
      herdrEnvironment,
      'createTab',
      'herdr-frontend'
    );
    if (!listed.ok) return listed;
    const parsed = parseJson(listed.value, 'herdr-frontend CLI');
    if (!parsed.ok) return parsed;
    const shown = localSpaces(parsed.value).some((space) =>
      spaceTabs(space).some(
        (tab) => tab.id === tabId && tabShowsTerminal(tab, terminal)
      )
    );
    if (shown) return 'shown';
    // herdr-frontend places only live terminals.
    if (await terminalEnded(herdrEnvironment, terminal)) return 'ended';
    if (Date.now() >= deadline) {
      return failed(
        'createTab',
        `The herdr-frontend window did not show the new tab within ${FRONTEND_TAB_TIMEOUT_MS / 1000} seconds.`,
        undefined,
        listed.value.stderr
      );
    }
    await sleep(FRONTEND_TAB_POLL_MS);
  }
}

// Whether herdr-core reports the terminal finished or no longer has it.
async function terminalEnded(
  herdrEnvironment: Readonly<NodeJS.ProcessEnv>,
  terminal: string
): Promise<boolean> {
  const got = await runHerdr(
    ['get', '--json', terminal],
    herdrEnvironment,
    'createTab',
    'hc'
  );
  if (!got.ok) return got.failure.stderr?.includes('"not_found"') ?? false;
  const parsed = parseJson(got.value, 'herdr-core CLI');
  return (
    parsed.ok && isRecord(parsed.value) && parsed.value.state === 'finished'
  );
}

// Missing, unreadable, or unknown contents select the Herdr app.
async function selectedApp(
  environment: Readonly<NodeJS.ProcessEnv>
): Promise<AppProgram> {
  const configHome =
    environment.XDG_CONFIG_HOME ||
    (environment.HOME ? join(environment.HOME, '.config') : undefined);
  if (configHome === undefined) return 'herdr-app';
  try {
    const selection = await readFile(
      join(configHome, 'herdr', 'frontend'),
      'utf8'
    );
    return selection.trim() === 'herdr-frontend'
      ? 'herdr-frontend'
      : 'herdr-app';
  } catch {
    return 'herdr-app';
  }
}

function parseStartedTerminal(
  output: ProcessOutput
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly failure: HerdrFailure } {
  const parsed = parseJson(output, 'herdr-core CLI');
  if (!parsed.ok) return parsed;
  const record = isRecord(parsed.value) ? parsed.value : {};
  const address =
    record.address ??
    (isRecord(record.terminal) ? record.terminal.address : undefined);
  if (typeof address === 'string' && address) {
    return { ok: true, value: address };
  }
  return failed(
    'createTab',
    'herdr-core CLI returned incompatible terminal data: address must be a string',
    undefined,
    output.stderr
  );
}

function findTerminalSpace(
  output: ProcessOutput,
  terminal: string,
  app: AppProgram
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly failure: HerdrFailure } {
  const parsed = parseJson(output, cliName(app));
  if (!parsed.ok) return parsed;
  for (const space of localSpaces(parsed.value)) {
    if (spaceTabs(space).some((tab) => tabShowsTerminal(tab, terminal))) {
      return { ok: true, value: space.id };
    }
  }
  const window = app === 'herdr-app' ? 'Herdr app' : 'herdr-frontend';
  return failed(
    'createTab',
    `The ${window} window does not show this terminal. Run review in a ${window} tab on this computer.`,
    undefined,
    output.stderr
  );
}

// The spaces on this computer in an `ls` listing. Spaces on other machines
// hold their terminals there.
function localSpaces(
  listing: unknown
): (Record<string, unknown> & { readonly id: string })[] {
  const spaces =
    isRecord(listing) && Array.isArray(listing.spaces) ? listing.spaces : [];
  return spaces.filter(
    (space): space is Record<string, unknown> & { readonly id: string } =>
      isRecord(space) && !space.machine && typeof space.id === 'string'
  );
}

function spaceTabs(space: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(space.tabs) ? space.tabs.filter(isRecord) : [];
}

function tabShowsTerminal(
  tab: Record<string, unknown>,
  terminal: string
): boolean {
  return (
    Array.isArray(tab.terminals) &&
    tab.terminals.some(
      (candidate) => isRecord(candidate) && candidate.terminal === terminal
    )
  );
}

function cliName(program: HerdrProgram): string {
  switch (program) {
    case 'herdr':
      return 'Herdr CLI';
    case 'herdr-app':
      return 'Herdr app CLI';
    case 'herdr-frontend':
      return 'herdr-frontend CLI';
    case 'hc':
      return 'herdr-core CLI';
  }
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
  const cli = cliName(program);
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
      // `herdr-app do` and `herdr-frontend do` report errors as JSON on stdout.
      program === 'herdr-app' || program === 'herdr-frontend'
        ? stderr || stdout
        : stderr
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

function optionalContext(
  environment: Readonly<NodeJS.ProcessEnv>
): HerdrContext | undefined {
  try {
    return readContext(environment);
  } catch {
    return undefined;
  }
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

// Herdr tabs are narrow, so the label leads with the pull request number and
// drops the repository owner.
function tabLabel(action: TabAction, pullRequest: PullRequestSummary): string {
  const name = action.kind === 'lumen' ? 'Lumen' : action.name;
  const repositoryName = pullRequest.repository.split('/').at(-1);
  return `${name} #${pullRequest.number}@${repositoryName}`;
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
