import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { GitHubFailure, GitHubOperation, GitHubResult } from '../types.ts';

export type ProcessOutput = {
  readonly stdout: string;
  readonly stderr: string;
};

export async function runGh(
  arguments_: readonly string[],
  stdin: string,
  operation: GitHubOperation,
  url: string | undefined,
  signal: AbortSignal,
  environment: Readonly<NodeJS.ProcessEnv> = process.env
): Promise<GitHubResult<ProcessOutput>> {
  return runProcess('gh', arguments_, stdin, operation, url, signal, {
    environment,
  });
}

/**
 * Runs a ghp read. ghp exits 3 when a result has no value and still prints
 * that result, with its error, as JSON.
 */
export function runGhp(
  arguments_: readonly string[],
  operation: GitHubOperation,
  url: string | undefined,
  signal: AbortSignal
): Promise<GitHubResult<ProcessOutput>> {
  return runProcess(
    'ghp',
    [...arguments_, '--consumer', 'review'],
    '',
    operation,
    url,
    signal,
    { successCodes: [0, ghpMissingValueExitCode] }
  );
}

/** ghp's exit status when a result has no value; it still prints the result. */
export const ghpMissingValueExitCode = 3;

async function runProcess(
  executable: 'gh' | 'ghp',
  arguments_: readonly string[],
  stdin: string,
  operation: GitHubOperation,
  url: string | undefined,
  signal: AbortSignal,
  {
    environment = process.env,
    successCodes = [0],
  }: {
    readonly environment?: Readonly<NodeJS.ProcessEnv>;
    readonly successCodes?: readonly number[];
  }
): Promise<GitHubResult<ProcessOutput>> {
  if (signal.aborted) {
    return failure({
      kind: 'interrupted',
      operation,
      ...(url === undefined ? {} : { url }),
      reason: 'aborted',
      stderr: '',
    });
  }

  const subprocess = spawn(executable, [...arguments_], {
    env: environment,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = createProcessState();

  subprocess.stdout.setEncoding('utf8');
  subprocess.stderr.setEncoding('utf8');
  subprocess.stdout.on('data', (chunk: string) => {
    state.stdout += chunk;
  });
  subprocess.stderr.on('data', (chunk: string) => {
    state.stderr += chunk;
  });
  const abort = (): void => {
    state.aborted = true;
    subprocess.kill('SIGTERM');
  };
  signal.addEventListener('abort', abort, { once: true });
  const inputSettled = sendInput(subprocess, state, stdin);

  const outcome = await new Promise<
    | { readonly kind: 'error'; readonly diagnostic: string }
    | {
        readonly kind: 'close';
        readonly exitCode: number | null;
        readonly signal: NodeJS.Signals | null;
      }
  >((resolve) => {
    subprocess.once('error', (error) => {
      resolve({ kind: 'error', diagnostic: describeError(error) });
    });
    subprocess.once('close', (exitCode, processSignal) => {
      resolve({ kind: 'close', exitCode, signal: processSignal });
    });
  });
  signal.removeEventListener('abort', abort);
  await inputSettled;

  if (outcome.kind === 'error') {
    return failure({
      kind: 'startup',
      operation,
      ...(url === undefined ? {} : { url }),
      executable,
      diagnostic: outcome.diagnostic,
    });
  }
  if (state.aborted) {
    return failure({
      kind: 'interrupted',
      operation,
      ...(url === undefined ? {} : { url }),
      reason: 'aborted',
      stderr: state.stderr,
    });
  }
  if (outcome.signal !== null) {
    return failure({
      kind: 'interrupted',
      operation,
      ...(url === undefined ? {} : { url }),
      reason: 'signal',
      signal: outcome.signal,
      stderr: state.stderr,
    });
  }
  if (outcome.exitCode === null || !successCodes.includes(outcome.exitCode)) {
    return failure({
      kind: 'exit',
      operation,
      ...(url === undefined ? {} : { url }),
      exitCode: outcome.exitCode ?? -1,
      stderr: state.stderr,
    });
  }
  if (state.inputDiagnostic !== undefined) {
    return failure({
      kind: 'interrupted',
      operation,
      ...(url === undefined ? {} : { url }),
      reason: 'io',
      diagnostic: state.inputDiagnostic,
      stderr: state.stderr,
    });
  }

  return {
    ok: true,
    value: { stdout: state.stdout, stderr: state.stderr },
  };
}

type ProcessState = {
  aborted: boolean;
  inputDiagnostic?: string;
  stderr: string;
  stdout: string;
};

function sendInput(
  subprocess: ChildProcessWithoutNullStreams,
  state: ProcessState,
  input: string
): Promise<undefined> {
  return new Promise((resolve) => {
    subprocess.stdin.on('error', (error) => {
      state.inputDiagnostic ??= describeError(error);
      resolve(undefined);
    });
    try {
      subprocess.stdin.end(input, 'utf8', () => {
        queueMicrotask(() => resolve(undefined));
      });
    } catch (error) {
      state.inputDiagnostic = describeError(error);
      resolve(undefined);
    }
  });
}

function createProcessState(): ProcessState {
  return { aborted: false, stderr: '', stdout: '' };
}

export function failure<Value = never>(
  failureValue: GitHubFailure
): GitHubResult<Value> {
  return { ok: false, failure: failureValue };
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
