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
  readonly workingDirectory: string;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly herdrEnvironment?: Readonly<NodeJS.ProcessEnv>;
};

type HerdrContext = {
  readonly workspaceId: string;
  readonly reviewQueueTabId: string;
};

type ProcessOutput = {
  readonly stdout: string;
  readonly stderr: string;
};

export function createHerdrCliAdapter(options: AdapterOptions): Herdr {
  const herdrEnvironment = options.herdrEnvironment ?? process.env;
  const context = readContext(herdrEnvironment);

  return {
    openLumen: (pullRequest) =>
      openHerdrTab(options, herdrEnvironment, context, 'lumen', pullRequest),
    openReviewCommand: (pullRequest) =>
      openHerdrTab(
        options,
        herdrEnvironment,
        context,
        'reviewCommand',
        pullRequest
      ),
  };
}

async function openHerdrTab(
  options: AdapterOptions,
  herdrEnvironment: Readonly<NodeJS.ProcessEnv>,
  context: HerdrContext,
  kind: 'lumen' | 'reviewCommand',
  pullRequest: PullRequestSummary
): Promise<HerdrResult> {
  if (
    kind === 'lumen' &&
    !(await isInsideRepository(options.workingDirectory))
  ) {
    return failed(
      'createTab',
      'lumen diff requires review to start inside a Git or Jujutsu repository.'
    );
  }

  const environment = childEnvironment(options.environment, kind, pullRequest);
  const create = await runHerdr(
    [
      'tab',
      'create',
      '--workspace',
      context.workspaceId,
      '--cwd',
      options.workingDirectory,
      '--label',
      tabLabel(kind, pullRequest),
      '--no-focus',
      ...environmentArguments(environment),
    ],
    herdrEnvironment,
    'createTab'
  );
  if (!create.ok) return create;

  const created = parseCreatedTab(create.value);
  if (!created.ok) return created;

  const command =
    kind === 'lumen'
      ? `lumen diff ${shellQuote(pullRequest.url)}`
      : `/bin/sh -c ${shellQuote(options.reviewCommand)}`;
  const run = await runHerdr(
    [
      'pane',
      'run',
      created.value.paneId,
      `${command}; herdr tab focus ${shellQuote(context.reviewQueueTabId)}`,
    ],
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

async function runHerdr(
  arguments_: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
  operation: HerdrOperation
): Promise<
  | { readonly ok: true; readonly value: ProcessOutput }
  | { readonly ok: false; readonly failure: HerdrFailure }
> {
  const subprocess = spawn('herdr', [...arguments_], {
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
    return failed(operation, `Herdr CLI could not start: ${outcome.message}`);
  }
  if (outcome.exitCode !== 0) {
    return failed(
      operation,
      `Herdr CLI failed while trying to ${operationDescription(operation)}.`,
      outcome.exitCode ?? -1,
      stderr
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
  output: ProcessOutput
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: HerdrFailure } {
  try {
    const value: unknown = JSON.parse(output.stdout);
    return { ok: true, value };
  } catch (error) {
    return failed(
      'createTab',
      `Herdr CLI returned malformed JSON: ${describeError(error)}`,
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
  kind: 'lumen' | 'reviewCommand',
  pullRequest: PullRequestSummary
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
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

function environmentArguments(
  environment: Readonly<Record<string, string>>
): string[] {
  return Object.entries(environment).flatMap(([name, value]) => [
    '--env',
    `${name}=${value}`,
  ]);
}

function tabLabel(
  kind: 'lumen' | 'reviewCommand',
  pullRequest: PullRequestSummary
): string {
  const name = kind === 'lumen' ? 'Lumen' : 'Review Command';
  return `${name} ${pullRequest.repository}#${pullRequest.number}`;
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
