import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testRender } from '@opentui/react/test-utils';
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { ReviewQueuePage } from '../src/app.tsx';
import { loadReviewConfiguration } from '../src/configuration/index.ts';
import { createGitHubCliAdapter } from '../src/github/cli-adapter.ts';
import type { CurrentRepositoryResult } from '../src/github/current-repository.ts';
import type { Herdr } from '../src/tools/types.ts';

notifyManager.setScheduler(queueMicrotask);
notifyManager.setNotifyFunction(act);

const configuredSearch = 'is:pr review-requested:@me state:open -is:draft';
const editedSearch = 'is:pr state:open is:draft label:"needs review"';
const editedArguments = [
  'is:pr',
  'state:open',
  'is:draft',
  'label:needs review',
];
const unusedHerdr = {
  async openDiff() {
    throw new Error('No diff expected');
  },
  async openReviewCommand() {
    throw new Error('No Review Command expected');
  },
} satisfies Herdr;

let directory: string;
let originalPath: string | undefined;
const views: Awaited<ReturnType<typeof testRender>>[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'review-search-'));
  originalPath = process.env.PATH;
  const executable = join(directory, 'gh');
  await Bun.write(
    executable,
    `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { tokenizeSearch } from ${JSON.stringify(join(process.cwd(), 'src/configuration/index.ts'))};
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(directory, 'calls.jsonl'))}, JSON.stringify(argv) + '\\n');
if (argv.some((arg) => arg.startsWith('searchQuery='))) {
  const text = argv.find((arg) => arg.startsWith('searchQuery=')).slice('searchQuery='.length);
  const end = text.lastIndexOf(' ) type:pr');
  const parsed = tokenizeSearch(text.slice(2, end));
  if (!parsed.ok) throw new Error(parsed.problem);
  const repository = text.slice(end + ' ) type:pr'.length).trim();
  const search = [...parsed.value, ...(repository ? [repository] : [])];
  appendFileSync(${JSON.stringify(join(directory, 'searches.jsonl'))}, JSON.stringify(search) + '\\n');
  if (search.includes('slow:test') && !search.includes('repo:acme/widgets')) await Bun.sleep(30_000);
  if (search.includes('empty:test')) {
    console.log(JSON.stringify({ data: { search: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    process.exit(0);
  }
  if (search.includes('bad:query')) {
    console.error('Unsupported search qualifier');
    process.exit(1);
  }
  const after = argv.find((arg) => arg.startsWith('after='))?.slice(6);
  const modeFile = ${JSON.stringify(join(directory, 'mode'))};
  const mode = existsSync(modeFile) ? readFileSync(modeFile, 'utf8') : '';
  if (after && mode === 'slow') await Bun.sleep(30_000);
  if (after && mode === 'error') { console.error('Page search failed'); process.exit(1); }
  const paginated = search.includes('page:test');
  const nodes = paginated ? (after && mode === 'empty' ? [] : [1, 2].map((row) => ({
    number: (after ? 20 : 10) + row, title: 'Page ' + (after ? 2 : 1) + ' PR ' + row,
    author: { login: 'octocat' }, isDraft: false, state: 'OPEN',
    createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-21T10:00:00Z',
    url: 'https://github.com/acme/widgets/pull/' + ((after ? 20 : 10) + row), repository: { nameWithOwner: 'acme/widgets' },
    labels: { nodes: [] }, comments: { totalCount: 0 }
  }))) : [{
    number: 7, title: (search.includes('repo:acme/widgets') ? 'Scoped ' : '') + (search.includes('author:@me') ? 'Authored PR' : search.includes('is:draft') ? 'Draft PR' : 'Configured PR'),
    author: { login: 'octocat' }, isDraft: search.includes('is:draft'), state: 'open',
    createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-21T10:00:00Z',
    url: 'https://github.com/acme/widgets/pull/7', repository: { nameWithOwner: 'acme/widgets' },
    labels: { nodes: [] }, comments: { totalCount: 0 }
  }];
  console.log(JSON.stringify({ data: { search: { nodes, pageInfo: { hasNextPage: paginated && !after, endCursor: paginated && !after ? 'page-one-end' : null } } } }));
} else {
  console.log(JSON.stringify({ additions: 1, deletions: 0, changedFiles: 1, reviewDecision: '', statusCheckRollup: [] }));
}
`
  );
  await chmod(executable, 0o755);
  process.env.PATH = `${directory}:${originalPath ?? ''}`;
  await Bun.write(
    join(directory, 'review', 'config.json'),
    JSON.stringify({
      github: { search: configuredSearch },
      reviewCommand: 'unused',
      config: { updateBehavior: 'off' },
    })
  );
});

afterEach(async () => {
  act(() => {
    for (const view of views.splice(0)) view.renderer.destroy();
  });
  jest.restoreAllMocks();
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  await rm(directory, { recursive: true, force: true });
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

async function renderQueue(
  loadCurrentRepository?: (
    signal: AbortSignal
  ) => Promise<CurrentRepositoryResult>
) {
  const loaded = await loadReviewConfiguration({ XDG_CONFIG_HOME: directory });
  if (!loaded.ok) throw new Error(loaded.failure.problem);
  const config = loaded.value;
  const adapter = createGitHubCliAdapter(config.githubSearch);
  const loadReviewQueue = jest.fn(adapter.loadReviewQueue);
  const onQuit = jest.fn();
  const view = await testRender(
    <ReviewQueuePage
      github={{ ...adapter, loadReviewQueue }}
      githubSearchText={config.githubSearchText}
      pageSize={config.pageSize}
      loadCurrentRepository={loadCurrentRepository}
      herdr={unusedHerdr}
      keyBindings={config.keyBindings}
      refreshIntervalMinutes={config.refreshIntervalMinutes}
      onQuit={onQuit}
    />,
    { width: 100, height: 24, exitOnCtrlC: false }
  );
  // The real child processes need wall-clock time, not just renderer flushes.
  view.waitForFrame = async (predicate) => {
    for (let pass = 0; pass < 200; pass += 1) {
      await act(async () => {
        await Bun.sleep(5);
        await view.renderOnce();
      });
      const frame = view.captureCharFrame();
      if (await predicate(frame)) return frame;
    }
    throw new Error(
      `Timed out waiting for gh and renderer:\n${view.captureCharFrame()}`
    );
  };
  views.push(view);
  return { view, onQuit, loadReviewQueue };
}

async function searches(): Promise<string[][]> {
  return (await Bun.file(join(directory, 'searches.jsonl')).text())
    .trim()
    .split('\n')
    .map((line) => {
      const search: unknown = JSON.parse(line);
      if (
        !Array.isArray(search) ||
        !search.every((term: unknown) => typeof term === 'string')
      ) {
        throw new Error('Expected recorded search arguments');
      }
      return search;
    });
}

async function replaceQuery(
  view: Awaited<ReturnType<typeof testRender>>,
  query: string
) {
  await act(async () => view.mockInput.pressKey('a', { ctrl: true }));
  await act(async () => view.mockInput.pressKey('k', { ctrl: true }));
  await act(async () => view.mockInput.typeText(query));
}

async function calls(): Promise<string[][]> {
  return (await Bun.file(join(directory, 'calls.jsonl')).text())
    .trim()
    .split('\n')
    .map((line) => {
      const value: unknown = JSON.parse(line);
      if (
        !Array.isArray(value) ||
        !value.every((part: unknown) => typeof part === 'string')
      )
        throw new Error('Expected argv');
      return value;
    });
}

async function pageRequests() {
  return (await calls()).filter((argv) =>
    argv.some((arg) => arg.startsWith('searchQuery='))
  );
}

async function configurePages(keyBindings?: Record<string, string[]>) {
  await Bun.write(
    join(directory, 'review', 'config.json'),
    JSON.stringify({
      github: { search: 'is:pr page:test state:open', pageSize: 2 },
      reviewCommand: 'unused',
      config: { updateBehavior: 'off' },
      keyBindings,
    })
  );
}

async function finishRefresh(view: Awaited<ReturnType<typeof testRender>>) {
  await view.waitForFrame(
    (frame) => frame.includes('updated') && !frame.includes('refreshing…')
  );
}

test('repo scope is shared by both lists and refreshes, separate from edits, and resets on restart', async () => {
  const file = Bun.file(join(directory, 'review', 'config.json'));
  const originalConfig = await file.text();
  const loadCurrentRepository = jest.fn(async () => ({
    ok: true as const,
    repository: { nameWithOwner: 'acme/widgets', hostname: 'github.com' },
  }));
  const intervalSpy = jest.spyOn(globalThis, 'setInterval');
  const { view } = await renderQueue(loadCurrentRepository);
  await view.waitForFrame((frame) => frame.includes('Configured PR'));
  expect(loadCurrentRepository).not.toHaveBeenCalled();
  expect(view.captureCharFrame()).toContain('All repositories');
  await act(async () => view.mockInput.pressKey('l'));
  await view.waitForFrame((frame) => frame.includes('Scoped Configured PR'));
  expect((await searches()).at(-1)).toEqual([
    'is:pr',
    'review-requested:@me',
    'state:open',
    '-is:draft',
    'repo:acme/widgets',
  ]);
  await act(async () => view.mockInput.pressKey('/'));
  const originalEditor = await view.waitForFrame((frame) =>
    frame.includes('Review Queue query')
  );
  expect(originalEditor).toContain(configuredSearch);
  expect(originalEditor).not.toContain('repo:acme/widgets');
  await replaceQuery(view, editedSearch);
  await act(view.mockInput.pressEnter);
  await view.waitForFrame((frame) => frame.includes('Scoped Draft PR'));
  expect((await searches()).at(-1)).toEqual([
    ...editedArguments,
    'repo:acme/widgets',
  ]);

  await act(async () => view.mockInput.pressKey('r'));
  await finishRefresh(view);
  expect((await searches()).at(-1)).toEqual([
    ...editedArguments,
    'repo:acme/widgets',
  ]);
  const intervalCallback = intervalSpy.mock.calls.findLast(
    ([, delay]) => delay === 5 * 60_000
  )?.[0];
  if (typeof intervalCallback !== 'function')
    throw new Error('Missing polling callback');
  await act(async () => {
    intervalCallback();
    await Promise.resolve();
  });
  await finishRefresh(view);
  expect((await searches()).at(-1)).toEqual([
    ...editedArguments,
    'repo:acme/widgets',
  ]);

  await act(async () => view.mockInput.pressKey('m'));
  await view.waitForFrame((frame) => frame.includes('Scoped Authored PR'));
  expect((await searches()).at(-1)).toEqual([
    'is:pr',
    'author:@me',
    'state:open',
    'repo:acme/widgets',
  ]);
  await act(async () => view.mockInput.pressKey('l'));
  await finishRefresh(view);
  expect(view.captureCharFrame()).toContain('All repositories');
  expect(view.captureCharFrame()).not.toContain('Scoped Authored PR');
  expect((await searches()).at(-1)).toEqual([
    'is:pr',
    'author:@me',
    'state:open',
  ]);
  await act(async () => view.mockInput.pressKey('m'));
  await finishRefresh(view);
  expect((await searches()).at(-1)).toEqual(editedArguments);
  await act(async () => view.mockInput.pressKey('/'));
  const editor = await view.waitForFrame((frame) =>
    frame.includes('Review Queue query')
  );
  expect(editor).toContain(editedSearch);
  await act(view.mockInput.pressEscape);
  await act(async () => view.mockInput.pressKey('l'));
  await finishRefresh(view);
  expect(loadCurrentRepository).toHaveBeenCalledTimes(1);
  expect(await file.text()).toBe(originalConfig);

  act(() => {
    view.renderer.destroy();
    views.splice(views.indexOf(view), 1);
  });
  const restarted = await renderQueue(loadCurrentRepository);
  await restarted.view.waitForFrame((frame) => frame.includes('Configured PR'));
  expect(restarted.view.captureCharFrame()).toContain('All repositories');
  expect((await searches()).at(-1)).not.toContain('repo:acme/widgets');
  expect(await file.text()).toBe(originalConfig);
});

test('scope supports remapping and empty lists, while resolution failure leaves queries unscoped and can be retried', async () => {
  await Bun.write(
    join(directory, 'review', 'config.json'),
    JSON.stringify({
      github: { search: 'is:pr empty:test' },
      reviewCommand: 'unused',
      keyBindings: { toggleRepositoryScope: ['f'] },
    })
  );
  let attempts = 0;
  const loadCurrentRepository = jest.fn(
    async (): Promise<CurrentRepositoryResult> => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, diagnostic: 'No GitHub remote for launch repository' }
        : {
            ok: true,
            repository: {
              nameWithOwner: 'acme/widgets',
              hostname: 'github.com',
            },
          };
    }
  );
  const { view } = await renderQueue(loadCurrentRepository);
  await view.waitForFrame((frame) => frame.includes('No reviews waiting'));
  await act(async () => view.mockInput.pressKey('l'));
  expect(loadCurrentRepository).not.toHaveBeenCalled();
  await act(async () => view.mockInput.pressKey('f'));
  await view.waitForFrame((frame) => frame.includes('No GitHub remote'));
  expect(view.captureCharFrame()).not.toContain('All repositories');
  expect(await searches()).toHaveLength(1);
  await act(async () => view.mockInput.pressKey('f'));
  await view.waitForFrame(
    async (frame) =>
      frame.includes('No reviews waiting') && (await searches()).length === 2
  );
  expect((await searches()).at(-1)).toEqual([
    'is:pr',
    'empty:test',
    'repo:acme/widgets',
  ]);
  await view.waitForFrame((frame) => frame.includes('No reviews waiting'));
  expect(view.captureCharFrame()).not.toContain('No GitHub remote');
  await act(async () => {
    view.resize(200, 30);
    view.mockInput.pressKey('?');
  });
  await view.waitForFrame((frame) =>
    frame.includes('f  toggle launch repository scope')
  );
});

test('scoping aborts an obsolete unscoped fetch and editors own the l key', async () => {
  await Bun.write(
    join(directory, 'review', 'config.json'),
    JSON.stringify({
      github: { search: 'is:pr slow:test' },
      reviewCommand: 'unused',
    })
  );
  const loadCurrentRepository = jest.fn(async () => ({
    ok: true as const,
    repository: { nameWithOwner: 'acme/widgets', hostname: 'github.com' },
  }));
  const { view, loadReviewQueue } = await renderQueue(loadCurrentRepository);
  await view.waitForFrame(
    async () => await Bun.file(join(directory, 'searches.jsonl')).exists()
  );
  const oldSignal = loadReviewQueue.mock.calls[0][0];
  await act(async () => view.mockInput.pressKey('/'));
  await view.waitForFrame((frame) => frame.includes('Review Queue query'));
  await act(async () => view.mockInput.pressKey('l'));
  expect(loadCurrentRepository).not.toHaveBeenCalled();
  await view.waitForFrame((frame) => frame.includes('lis:pr slow:test'));
  await act(view.mockInput.pressEscape);
  await view.waitForFrame((frame) => !frame.includes('Review Queue query'));
  await act(async () => view.mockInput.pressKey('l'));
  await view.waitForFrame((frame) => frame.includes('Scoped Configured PR'));
  expect(oldSignal.aborted).toBe(true);
  expect((await searches()).at(-1)).toEqual([
    'is:pr',
    'slow:test',
    'repo:acme/widgets',
  ]);
});

test('edits the real gh query for this session, refreshes with it, preserves it across My PRs, and never saves it', async () => {
  const file = Bun.file(join(directory, 'review', 'config.json'));
  const originalConfig = await file.text();
  const intervalSpy = jest.spyOn(globalThis, 'setInterval');
  const { view, onQuit } = await renderQueue();
  await view.waitForFrame((frame) => frame.includes('Configured PR'));
  await act(async () => view.mockInput.pressKey('/'));
  const editor = await view.waitForFrame((frame) =>
    frame.includes('Review Queue query')
  );
  expect(editor).toContain(configuredSearch);
  await replaceQuery(view, editedSearch);
  expect(onQuit).not.toHaveBeenCalled();
  expect(await searches()).toHaveLength(1);
  await act(view.mockInput.pressEnter);
  const edited = await view.waitForFrame((frame) => frame.includes('Draft PR'));
  expect(edited).not.toContain('Review Queue query');
  expect(edited).not.toContain('Configured PR');
  expect((await searches()).at(-1)).toEqual(editedArguments);

  await act(async () => view.mockInput.pressKey('r'));
  await finishRefresh(view);
  expect(await searches()).toHaveLength(3);
  expect((await searches()).at(-1)).toEqual(editedArguments);
  const intervalCallback = intervalSpy.mock.calls.findLast(
    ([, delay]) => delay === 5 * 60_000
  )?.[0];
  if (typeof intervalCallback !== 'function')
    throw new Error('Missing polling callback');
  await act(async () => {
    intervalCallback();
    await Promise.resolve();
  });
  await finishRefresh(view);
  expect(await searches()).toHaveLength(4);
  expect((await searches()).at(-1)).toEqual(editedArguments);

  await act(async () => view.mockInput.pressKey('/'));
  const reopened = await view.waitForFrame((frame) =>
    frame.includes('Review Queue query')
  );
  expect(reopened).toContain(editedSearch);
  await act(view.mockInput.pressEnter);
  await finishRefresh(view);
  expect(await searches()).toHaveLength(5);

  await act(async () => view.mockInput.pressKey('m'));
  await view.waitForFrame((frame) => frame.includes('Authored PR'));
  expect((await searches()).at(-1)).toEqual([
    'is:pr',
    'author:@me',
    'state:open',
  ]);
  await act(async () => view.mockInput.pressKey('/'));
  expect(view.captureCharFrame()).not.toContain('Review Queue query');
  await act(async () => view.mockInput.pressKey('r'));
  await finishRefresh(view);
  expect((await searches()).at(-1)).toEqual([
    'is:pr',
    'author:@me',
    'state:open',
  ]);
  await act(async () => view.mockInput.pressKey('m'));
  await finishRefresh(view);
  expect((await searches()).at(-1)).toEqual(editedArguments);
  await act(async () => view.mockInput.pressKey('/'));
  const preserved = await view.waitForFrame((frame) =>
    frame.includes('Review Queue query')
  );
  expect(preserved).toContain(editedSearch);
  await act(view.mockInput.pressEscape);
  expect(onQuit).not.toHaveBeenCalled();
  expect(await file.text()).toBe(originalConfig);

  act(() => {
    view.renderer.destroy();
    views.splice(views.indexOf(view), 1);
  });
  const restarted = await renderQueue();
  await restarted.view.waitForFrame((frame) => frame.includes('Configured PR'));
  expect((await searches()).at(-1)).toEqual([
    'is:pr',
    'review-requested:@me',
    'state:open',
    '-is:draft',
  ]);
  expect(await file.text()).toBe(originalConfig);
});

test('Escape discards edits and invalid tokenization keeps the modal open without fetching', async () => {
  const { view, onQuit } = await renderQueue();
  await view.waitForFrame((frame) => frame.includes('Configured PR'));
  await act(async () => view.mockInput.pressKey('/'));
  await view.waitForFrame((frame) => frame.includes('Review Queue query'));
  await replaceQuery(view, '');
  await act(view.mockInput.pressEnter);
  await view.waitForFrame((frame) =>
    frame.includes('Search must produce a nonempty argument')
  );
  await replaceQuery(view, 'label:"unfinished');
  await act(view.mockInput.pressEnter);
  await view.waitForFrame((frame) =>
    frame.includes('Search has an unclosed double quote')
  );
  await replaceQuery(view, editedSearch);
  await act(view.mockInput.pressEscape);
  await view.waitForFrame((frame) => !frame.includes('Review Queue query'));
  expect(await searches()).toHaveLength(1);
  expect(onQuit).not.toHaveBeenCalled();
  await act(async () => view.mockInput.pressKey('/'));
  const reopened = await view.waitForFrame((frame) =>
    frame.includes('Review Queue query')
  );
  expect(reopened).toContain(configuredSearch);
});

test('supports a remapped editor key, multiline queries, and an empty Review Queue', async () => {
  const search = 'is:pr\nstate:open empty:test';
  await Bun.write(
    join(directory, 'review', 'config.json'),
    JSON.stringify({
      github: { search },
      reviewCommand: 'unused',
      keyBindings: { editReviewQueueSearch: ['f'] },
    })
  );
  const { view } = await renderQueue();
  await view.waitForFrame((frame) => frame.includes('No reviews waiting'));
  await act(async () => view.mockInput.pressKey('/'));
  await view.renderOnce();
  expect(view.captureCharFrame()).not.toContain('Review Queue query');
  await act(async () => view.mockInput.pressKey('f'));
  const editor = await view.waitForFrame((frame) =>
    frame.includes('Review Queue query')
  );
  expect(editor).toContain('state:open empty:test');
  await act(view.mockInput.pressEnter);
  await view.waitForFrame(
    (frame) =>
      !frame.includes('Review Queue query') &&
      frame.includes('No reviews waiting')
  );
  await view.waitForFrame(async () => (await searches()).length === 2);
  expect((await searches()).at(-1)).toEqual([
    'is:pr',
    'state:open',
    'empty:test',
  ]);
});

test('changing the query aborts an obsolete fetch and cannot display its results', async () => {
  await Bun.write(
    join(directory, 'review', 'config.json'),
    JSON.stringify({
      github: { search: 'is:pr slow:test' },
      reviewCommand: 'unused',
    })
  );
  const { view, loadReviewQueue } = await renderQueue();
  await view.waitForFrame(
    async (frame) =>
      frame.includes('Fetching PRs to review') &&
      (await Bun.file(join(directory, 'searches.jsonl')).exists())
  );
  const oldSignal = loadReviewQueue.mock.calls[0][0];
  expect(oldSignal.aborted).toBe(false);
  await act(async () => view.mockInput.pressKey('/'));
  await view.waitForFrame((frame) => frame.includes('Review Queue query'));
  await replaceQuery(view, editedSearch);
  await act(view.mockInput.pressEnter);
  expect(oldSignal.aborted).toBe(true);
  const updated = await view.waitForFrame((frame) =>
    frame.includes('Draft PR')
  );
  expect(updated).not.toContain('Configured PR');
  expect((await searches()).at(-1)).toEqual(editedArguments);
});

test('pages fetch and enrich only their own rows, reset the Cursor, and manual refresh restarts', async () => {
  await configurePages();
  const { view } = await renderQueue();
  await view.waitForFrame((frame) => frame.includes('Page 1 PR 2'));
  expect(view.captureCharFrame()).toContain('Page 1 · p previous · n next');
  expect(await pageRequests()).toHaveLength(1);
  expect((await pageRequests())[0]).toContain('size=2');
  expect((await calls()).filter((argv) => argv[0] === 'pr')).toHaveLength(2);
  await act(async () => view.mockInput.pressKey('p'));
  expect(await pageRequests()).toHaveLength(1);
  await act(async () => view.mockInput.pressKey('j'));
  await act(async () => view.mockInput.pressKey('n'));
  await view.waitForFrame((frame) => frame.includes('Page 2 PR 2'));
  expect(view.captureCharFrame()).toContain('Page 2 · p previous · last page');
  expect(await pageRequests()).toHaveLength(2);
  expect((await pageRequests())[1]).toContain('after=page-one-end');
  expect((await calls()).filter((argv) => argv[0] === 'pr')).toHaveLength(4);
  await act(async () => view.mockInput.pressKey('b'));
  await view.waitForFrame(async () =>
    (await calls()).some((argv) => argv.includes('--web'))
  );
  expect((await calls()).at(-1)).toEqual([
    'pr',
    'view',
    'https://github.com/acme/widgets/pull/21',
    '--web',
  ]);
  await act(async () => view.mockInput.pressKey('n'));
  expect(await pageRequests()).toHaveLength(2);
  await act(async () => view.mockInput.pressKey('p'));
  await view.waitForFrame(
    (frame) => frame.includes('Page 1 PR 1') && !frame.includes('refreshing…')
  );
  expect(
    (await pageRequests()).at(-1)?.some((arg) => arg.startsWith('after='))
  ).toBe(false);
  await act(async () => view.mockInput.pressKey('n'));
  await view.waitForFrame(
    (frame) => frame.includes('Page 2 PR 1') && !frame.includes('refreshing…')
  );
  await act(async () => view.mockInput.pressKey('r'));
  await view.waitForFrame(
    (frame) => frame.includes('Page 1 PR 1') && !frame.includes('refreshing…')
  );
  expect(
    (await pageRequests()).at(-1)?.some((arg) => arg.startsWith('after='))
  ).toBe(false);
});

test('automatic refresh reuses the page start, retains failures, and returns empty pages to page 1', async () => {
  await configurePages();
  const intervalSpy = jest.spyOn(globalThis, 'setInterval');
  const { view } = await renderQueue();
  await view.waitForFrame((frame) => frame.includes('Page 1 PR 1'));
  await act(async () => view.mockInput.pressKey('n'));
  await view.waitForFrame((frame) => frame.includes('Page 2 PR 1'));
  const poll = async () => {
    const callback = intervalSpy.mock.calls.findLast(
      ([, delay]) => delay === 5 * 60_000
    )?.[0];
    if (typeof callback !== 'function')
      throw new Error('Missing polling callback');
    await act(async () => {
      callback();
      await Promise.resolve();
    });
  };
  await poll();
  await finishRefresh(view);
  expect((await pageRequests()).at(-1)).toContain('after=page-one-end');
  await Bun.write(join(directory, 'mode'), 'error');
  await poll();
  await view.waitForFrame((frame) => frame.includes('Page search failed'));
  expect(view.captureCharFrame()).toContain('Page 2 PR 1');
  await Bun.write(join(directory, 'mode'), 'empty');
  await poll();
  await view.waitForFrame(
    (frame) => frame.includes('Page 1 PR 1') && !frame.includes('refreshing…')
  );
  const requests = await pageRequests();
  expect(requests.at(-2)).toContain('after=page-one-end');
  expect(requests.at(-1)?.some((arg) => arg.startsWith('after='))).toBe(false);
  await poll();
  await finishRefresh(view);
  expect(
    (await pageRequests()).at(-1)?.some((arg) => arg.startsWith('after='))
  ).toBe(false);
  // An empty page is cached. It must be re-fetched if rows later return.
  await Bun.write(join(directory, 'mode'), '');
  const beforeRevisit = (await pageRequests()).length;
  await act(async () => view.mockInput.pressKey('n'));
  await view.waitForFrame(
    (frame) => frame.includes('Page 2 PR 1') && !frame.includes('refreshing…')
  );
  expect(await pageRequests()).toHaveLength(beforeRevisit + 1);
  expect((await pageRequests()).at(-1)).toContain('after=page-one-end');
});

test('query, scope, and list changes reset pagination, including applying an unchanged query', async () => {
  await configurePages();
  const { view } = await renderQueue(async () => ({
    ok: true,
    repository: { nameWithOwner: 'acme/widgets', hostname: 'github.com' },
  }));
  await view.waitForFrame((frame) => frame.includes('Page 1 PR 1'));
  const next = async () => {
    await act(async () => view.mockInput.pressKey('n'));
    await view.waitForFrame(
      (frame) => frame.includes('Page 2 PR 1') && !frame.includes('refreshing…')
    );
  };
  const first = async () => {
    await view.waitForFrame(
      (frame) => frame.includes('Page 1 PR 1') && !frame.includes('refreshing…')
    );
    expect(
      (await pageRequests()).at(-1)?.some((arg) => arg.startsWith('after='))
    ).toBe(false);
  };
  await next();
  await act(async () => view.mockInput.pressKey('/'));
  await view.waitForFrame((frame) => frame.includes('Review Queue query'));
  await act(view.mockInput.pressEnter);
  await first();
  await next();
  await act(async () => view.mockInput.pressKey('l'));
  await first();
  expect((await searches()).at(-1)).toContain('repo:acme/widgets');
  await next();
  await act(async () => view.mockInput.pressKey('m'));
  await view.waitForFrame((frame) => frame.includes('Authored PR'));
  expect(
    (await pageRequests()).at(-1)?.some((arg) => arg.startsWith('after='))
  ).toBe(false);
  await act(async () => view.mockInput.pressKey('m'));
  await first();
  await next();
  await act(async () => view.mockInput.pressKey('/'));
  await view.waitForFrame((frame) => frame.includes('Review Queue query'));
  await replaceQuery(view, editedSearch);
  await act(view.mockInput.pressEnter);
  await view.waitForFrame((frame) => frame.includes('Draft PR'));
  expect(
    (await pageRequests()).at(-1)?.some((arg) => arg.startsWith('after='))
  ).toBe(false);
});

test('remapped page keys work and manual refresh cancels an obsolete page fetch', async () => {
  await configurePages({
    nextPullRequestPage: [']'],
    previousPullRequestPage: ['['],
  });
  const { view, loadReviewQueue } = await renderQueue();
  await view.waitForFrame((frame) => frame.includes('Page 1 PR 1'));
  await act(async () => view.mockInput.pressKey('n'));
  expect(await pageRequests()).toHaveLength(1);
  await Bun.write(join(directory, 'mode'), 'slow');
  await act(async () => view.mockInput.pressKey(']'));
  await view.waitForFrame((frame) => frame.includes('Fetching PRs'));
  const oldSignal = loadReviewQueue.mock.calls.at(-1)?.[0];
  await act(async () => view.mockInput.pressKey('r'));
  await view.waitForFrame(
    (frame) => frame.includes('Page 1 PR 1') && !frame.includes('refreshing…')
  );
  expect(oldSignal?.aborted).toBe(true);
  expect(
    (await pageRequests()).at(-1)?.some((arg) => arg.startsWith('after='))
  ).toBe(false);
  await Bun.write(join(directory, 'mode'), '');
  await act(async () => view.mockInput.pressKey(']'));
  await view.waitForFrame((frame) => frame.includes('Page 2 PR 1'));
  await act(async () => view.mockInput.pressKey('['));
  await view.waitForFrame(
    (frame) => frame.includes('Page 1 PR 1') && !frame.includes('refreshing…')
  );
});

test('a GitHub query error stays active for retry and can be repaired in the editor', async () => {
  const { view } = await renderQueue();
  await view.waitForFrame((frame) => frame.includes('Configured PR'));
  await act(async () => view.mockInput.pressKey('/'));
  await view.waitForFrame((frame) => frame.includes('Review Queue query'));
  await replaceQuery(view, 'bad:query');
  await act(view.mockInput.pressEnter);
  await view.waitForFrame((frame) =>
    frame.includes('Unsupported search qualifier')
  );
  await act(async () => view.mockInput.pressKey('r'));
  await view.waitForFrame((frame) =>
    frame.includes('Unsupported search qualifier')
  );
  // Opening the editor also verifies it works when the queue has no rows.
  await act(async () => view.mockInput.pressKey('/'));
  const editor = await view.waitForFrame((frame) =>
    frame.includes('Review Queue query')
  );
  expect(editor).toContain('bad:query');
  await replaceQuery(view, editedSearch);
  await act(view.mockInput.pressEnter);
  await view.waitForFrame((frame) => frame.includes('Draft PR'));
  expect((await searches()).at(-1)).toEqual(editedArguments);
});
