import type { GitHubOperation, GitHubResult } from '../types.ts';
import { parseOutput, record } from './json.ts';
import { failure, ghpMissingValueExitCode, runGhp } from './process.ts';

export type GhpValue = {
  readonly value: unknown;
  readonly stderr: string;
};

/**
 * Reads one result through ghp's shared GitHub cache. A result without a
 * value fails with GitHub's error. A value that failed to refresh is still
 * returned, so the Review Queue keeps showing data during a rate limit.
 */
export async function readGhp(
  arguments_: readonly string[],
  operation: GitHubOperation,
  url: string | undefined,
  signal: AbortSignal
): Promise<GitHubResult<GhpValue>> {
  const processResult = await runGhp(arguments_, operation, url, signal);
  if (!processResult.ok) return processResult;
  const envelope = parseOutput(
    processResult.value,
    operation,
    (value) => {
      const result = record(value, '$');
      return {
        value: result.value ?? null,
        error: typeof result.error === 'string' ? result.error : null,
      };
    },
    url
  );
  if (!envelope.ok) return envelope;
  if (envelope.value.value === null) {
    return failure({
      kind: 'exit',
      operation,
      ...(url === undefined ? {} : { url }),
      exitCode: ghpMissingValueExitCode,
      stderr: envelope.value.error ?? 'ghp returned no result',
    });
  }
  return {
    ok: true,
    value: {
      value: envelope.value.value,
      stderr: processResult.value.stderr,
    },
  };
}
