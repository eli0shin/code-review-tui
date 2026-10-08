import type { DiffSide } from '../../domain/pull-request.ts';
import type { GitHubOperation, GitHubResult } from '../types.ts';
import {
  runGh,
  failure,
  describeError,
  type ProcessOutput,
} from './process.ts';

export async function loadDetailSource<Value>(
  arguments_: readonly string[],
  operation: GitHubOperation,
  url: string,
  signal: AbortSignal,
  parse: (value: unknown) => Value
): Promise<GitHubResult<Value>> {
  const processResult = await runGh(arguments_, '', operation, url, signal);
  if (!processResult.ok) return processResult;
  return parseOutput(processResult.value, operation, parse, url);
}

export function parseOutput<Value>(
  output: ProcessOutput,
  operation: GitHubOperation,
  parse: (value: unknown) => Value,
  url?: string
): GitHubResult<Value> {
  const parsed = parseJson(output, operation, url);
  if (!parsed.ok) return parsed;
  return validateJson(parsed.value, output.stderr, operation, parse, url);
}

function parseJson(
  output: ProcessOutput,
  operation: GitHubOperation,
  url?: string
): GitHubResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(output.stdout) };
  } catch (error) {
    return failure({
      kind: 'malformedData',
      operation,
      ...(url === undefined ? {} : { url }),
      diagnostic: `GitHub CLI returned malformed JSON: ${describeError(error)}`,
      stderr: output.stderr,
    });
  }
}

function validateJson<Value>(
  value: unknown,
  stderr: string,
  operation: GitHubOperation,
  parse: (value: unknown) => Value,
  url?: string
): GitHubResult<Value> {
  try {
    return { ok: true, value: parse(value) };
  } catch (error) {
    const diagnostic =
      error instanceof CompatibilityError
        ? error.message
        : `GitHub CLI returned incompatible data: ${describeError(error)}`;
    return failure({
      kind: 'incompatibleData',
      operation,
      ...(url === undefined ? {} : { url }),
      diagnostic,
      stderr,
    });
  }
}

export function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw incompatible(path, 'an object');
  }
  return Object.fromEntries(Object.entries(value));
}

export function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw incompatible(path, 'an array');
  return value;
}

export function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw incompatible(path, 'a string');
  return value;
}

export function nullableRecord(
  value: unknown,
  path: string
): Record<string, unknown> | null {
  return value === null ? null : record(value, path);
}

export function diffSide(value: unknown, path: string): DiffSide {
  if (value !== 'LEFT' && value !== 'RIGHT')
    throw incompatible(path, 'LEFT or RIGHT');
  return value;
}

export function nullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : integer(value, path);
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw incompatible(path, 'a boolean');
  return value;
}

export function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw incompatible(path, 'a safe integer');
  }
  return value;
}

export class CompatibilityError extends Error {}

export function incompatible(
  path: string,
  expected: string
): CompatibilityError {
  return new CompatibilityError(
    `GitHub CLI returned incompatible data: ${path} must be ${expected}`
  );
}
