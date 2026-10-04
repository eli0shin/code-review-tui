import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHubRepository } from './types.ts';

const execute = promisify(execFile);

async function isInsideGitRepository(
  workingDirectory: string,
  signal: AbortSignal
): Promise<boolean> {
  try {
    await execute('git', ['rev-parse', '--show-toplevel'], {
      cwd: workingDirectory,
      signal,
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

export type CurrentRepositoryResult =
  | { readonly ok: true; readonly repository: GitHubRepository }
  | { readonly ok: false; readonly diagnostic: string };

export async function resolveCurrentRepository(
  workingDirectory: string,
  signal: AbortSignal
): Promise<CurrentRepositoryResult> {
  const options = { cwd: workingDirectory, signal, timeout: 10_000 };
  if (!(await isInsideGitRepository(workingDirectory, signal))) {
    return {
      ok: false,
      diagnostic:
        'Repository scope requires review to start inside a Git repository.',
    };
  }

  try {
    // GH_REPO must not redirect discovery away from the launch directory.
    const environment = { ...process.env };
    delete environment.GH_REPO;
    const { stdout } = await execute(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner,url'],
      { ...options, env: environment }
    );
    const data: unknown = JSON.parse(stdout);
    if (
      typeof data !== 'object' ||
      data === null ||
      !('nameWithOwner' in data) ||
      typeof data.nameWithOwner !== 'string' ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(data.nameWithOwner) ||
      !('url' in data) ||
      typeof data.url !== 'string'
    ) {
      throw new Error('GitHub CLI did not return a repository name and URL.');
    }
    const url = new URL(data.url);
    if (
      url.protocol !== 'https:' ||
      url.pathname.toLowerCase() !== `/${data.nameWithOwner.toLowerCase()}`
    ) {
      throw new Error('GitHub CLI returned an incompatible repository URL.');
    }
    if (url.hostname !== 'github.com' && !url.hostname.endsWith('.ghe.com')) {
      const { stdout: version } = await execute(
        'gh',
        [
          'api',
          '--hostname',
          url.hostname,
          'meta',
          '--jq',
          '.installed_version',
        ],
        { ...options, env: environment }
      );
      const match = /^(\d+)\.(\d+)\./.exec(version.trim());
      if (
        match === null ||
        Number(match[1]) < 3 ||
        (Number(match[1]) === 3 && Number(match[2]) < 18)
      ) {
        return {
          ok: false,
          diagnostic: `Repository scope requires advanced search on ${url.hostname} (GitHub Enterprise Server 3.18 or newer).`,
        };
      }
    }
    return {
      ok: true,
      repository: { nameWithOwner: data.nameWithOwner, hostname: url.hostname },
    };
  } catch (error) {
    return {
      ok: false,
      diagnostic: `Could not resolve the launch repository: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
