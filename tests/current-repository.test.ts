import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveCurrentRepository } from '../src/github/current-repository.ts';

const execute = promisify(execFile);
let directory: string;
let repository: string;
let originalPath: string | undefined;
let originalGhRepo: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'review-repository-'));
  repository = join(directory, 'repository');
  originalPath = process.env.PATH;
  originalGhRepo = process.env.GH_REPO;
  await execute('git', ['init', repository]);
  await fakeGh(
    'console.log(JSON.stringify({ nameWithOwner: "acme/widgets", url: "https://github.com/acme/widgets" }));'
  );
  process.env.PATH = `${directory}:${originalPath ?? ''}`;
});

afterEach(async () => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalGhRepo === undefined) delete process.env.GH_REPO;
  else process.env.GH_REPO = originalGhRepo;
  await rm(directory, { recursive: true, force: true });
});

async function fakeGh(body: string) {
  const executable = join(directory, 'gh');
  await Bun.write(
    executable,
    `#!/usr/bin/env bun
await Bun.write(${JSON.stringify(join(directory, 'gh-call.json'))}, JSON.stringify({
  argv: process.argv.slice(2), cwd: process.cwd(), ghRepo: process.env.GH_REPO ?? null,
}));
${body}
`
  );
  await chmod(executable, 0o755);
}

test('resolves from the launch directory inside Git, ignoring GH_REPO', async () => {
  const nested = join(repository, 'nested');
  await mkdir(nested);
  process.env.GH_REPO = 'wrong/repository';
  expect(
    await resolveCurrentRepository(nested, new AbortController().signal)
  ).toEqual({
    ok: true,
    repository: { nameWithOwner: 'acme/widgets', hostname: 'github.com' },
  });
  expect(await Bun.file(join(directory, 'gh-call.json')).json()).toEqual({
    argv: ['repo', 'view', '--json', 'nameWithOwner,url'],
    cwd: nested,
    ghRepo: null,
  });
  expect(process.env.GH_REPO).toBe('wrong/repository');
});

test('preserves the canonical Enterprise host instead of assuming github.com', async () => {
  await fakeGh(
    'console.log(process.argv[2] === "api" ? "3.18.0" : JSON.stringify({ nameWithOwner: "acme/widgets", url: "https://github.enterprise.example/acme/widgets" }));'
  );
  expect(
    await resolveCurrentRepository(repository, new AbortController().signal)
  ).toEqual({
    ok: true,
    repository: {
      nameWithOwner: 'acme/widgets',
      hostname: 'github.enterprise.example',
    },
  });
});

test('rejects legacy Enterprise search rather than widening the saved query', async () => {
  await fakeGh(
    'console.log(process.argv[2] === "api" ? "3.17.9" : JSON.stringify({ nameWithOwner: "acme/widgets", url: "https://github.enterprise.example/acme/widgets" }));'
  );
  const result = await resolveCurrentRepository(
    repository,
    new AbortController().signal
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected unsupported legacy search');
  expect(result.diagnostic).toContain('3.18 or newer');
  expect(await Bun.file(join(directory, 'gh-call.json')).json()).toHaveProperty(
    'argv',
    [
      'api',
      '--hostname',
      'github.enterprise.example',
      'meta',
      '--jq',
      '.installed_version',
    ]
  );
});

test('outside Git leaves scoping unavailable without invoking gh', async () => {
  const result = await resolveCurrentRepository(
    directory,
    new AbortController().signal
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected unavailable repository scope');
  expect(result.diagnostic).toContain('inside a Git repository');
  expect(await Bun.file(join(directory, 'gh-call.json')).exists()).toBe(false);
});

test('reports GitHub remote/authentication errors and rejects invalid repository names', async () => {
  await fakeGh('console.error("No GitHub remote"); process.exit(1);');
  const failed = await resolveCurrentRepository(
    repository,
    new AbortController().signal
  );
  expect(failed.ok).toBe(false);
  if (failed.ok) throw new Error('Expected GitHub resolution failure');
  expect(failed.diagnostic).toContain('No GitHub remote');
  await fakeGh(
    'console.log(JSON.stringify({ nameWithOwner: "not an owner/repository", url: "https://github.com/acme/widgets" }));'
  );
  const invalid = await resolveCurrentRepository(
    repository,
    new AbortController().signal
  );
  expect(invalid.ok).toBe(false);
  if (invalid.ok) throw new Error('Expected invalid repository name');
  expect(invalid.diagnostic).toContain(
    'did not return a repository name and URL'
  );
  await fakeGh(
    'console.log(JSON.stringify({ nameWithOwner: "acme/widgets", url: "https://github.com/another/repository" }));'
  );
  const mismatched = await resolveCurrentRepository(
    repository,
    new AbortController().signal
  );
  expect(mismatched.ok).toBe(false);
  if (mismatched.ok) throw new Error('Expected incompatible repository URL');
  expect(mismatched.diagnostic).toContain('incompatible repository URL');
});

test('a cancelled resolution does not invoke gh', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(
    (await resolveCurrentRepository(repository, controller.signal)).ok
  ).toBe(false);
  expect(await Bun.file(join(directory, 'gh-call.json')).exists()).toBe(false);
});
