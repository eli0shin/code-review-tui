import type { KeyEvent } from '@opentui/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import type {
  GitHub,
  GitHubFailure,
  GitHubRepository,
  RepositoryCount,
} from '../../github/types.ts';
import { matchesAction, stopKey } from '../terminal/keys.ts';
import type { useReviewQueue } from './use-review-queue.ts';

/** How often the panel's repository list refreshes in the background. */
const repositoryRefreshMilliseconds = 60_000;

export type RepositoryFilterRow =
  | { readonly kind: 'all' }
  | {
      readonly kind: 'repository';
      readonly nameWithOwner: string;
      readonly count: number;
      readonly checked: boolean;
    };

export function useRepositoryFilter({
  github,
  reviewQueue,
  repository,
  keyBindings,
  onChanged,
}: {
  readonly github: GitHub;
  readonly reviewQueue: Pick<
    ReturnType<typeof useReviewQueue>,
    'list' | 'listSearch' | 'repositoryFilter' | 'setRepositoryFilter'
  >;
  readonly repository: GitHubRepository | undefined;
  readonly keyBindings: EffectiveKeyBindings;
  /** Runs after the filter changes the shown list. */
  readonly onChanged: () => void;
}) {
  const { list, listSearch, repositoryFilter, setRepositoryFilter } =
    reviewQueue;
  // Polled while the list is shown, so the panel usually opens with data.
  const repositories = useQuery<readonly RepositoryCount[], GitHubFailure>({
    queryKey: ['reviewQueueRepositories', list, listSearch ?? null, repository],
    async queryFn({ signal }) {
      const result = await github.loadReviewQueueRepositories(
        signal,
        list,
        listSearch,
        repository
      );
      if (!result.ok) throw result.failure;
      return result.value;
    },
    refetchInterval: repositoryRefreshMilliseconds,
  });
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  const checked = new Set(repositoryFilter);
  const found = repositories.data ?? [];
  const foundNames = new Set(found.map((entry) => entry.nameWithOwner));
  const rows: readonly RepositoryFilterRow[] = [
    { kind: 'all' },
    ...found.map((entry): RepositoryFilterRow => ({
      kind: 'repository',
      ...entry,
      checked: checked.has(entry.nameWithOwner),
    })),
    // A checked repository can drop out of the search; keep it uncheckable.
    ...repositoryFilter
      .filter((name) => !foundNames.has(name))
      .map((nameWithOwner): RepositoryFilterRow => ({
        kind: 'repository',
        nameWithOwner,
        count: 0,
        checked: true,
      })),
  ];
  const cursorPosition = Math.min(cursor, rows.length - 1);

  function toggle(row: RepositoryFilterRow): void {
    if (row.kind === 'all') {
      setRepositoryFilter([]);
    } else if (row.checked) {
      setRepositoryFilter(
        repositoryFilter.filter((name) => name !== row.nameWithOwner)
      );
    } else {
      setRepositoryFilter([...repositoryFilter, row.nameWithOwner]);
    }
    onChanged();
  }

  function showOnly(row: RepositoryFilterRow): void {
    setRepositoryFilter(row.kind === 'all' ? [] : [row.nameWithOwner]);
    onChanged();
    setOpen(false);
  }

  function handleKey(key: KeyEvent): void {
    if (!open) return;
    stopKey(key);
    const row = rows.at(cursorPosition);
    if (key.name === 'space') {
      if (row !== undefined) toggle(row);
    } else if (key.name === 'return' || key.name === 'enter') {
      if (row !== undefined) showOnly(row);
    } else if (matchesAction(key, keyBindings, 'selectPrevious')) {
      setCursor(Math.max(cursorPosition - 1, 0));
    } else if (matchesAction(key, keyBindings, 'selectNext')) {
      setCursor(Math.min(cursorPosition + 1, rows.length - 1));
    } else if (
      key.name === 'escape' ||
      matchesAction(key, keyBindings, 'quit') ||
      matchesAction(key, keyBindings, 'filterRepositories')
    ) {
      setOpen(false);
    }
  }

  function openPanel(): void {
    setCursor(0);
    setOpen(true);
  }

  return {
    open,
    rows,
    cursorPosition,
    loading: repositories.isPending,
    failure: repositories.data === undefined ? repositories.error : null,
    openPanel,
    handleKey,
  };
}

/** The header's scope text when a repository filter is active. */
export function repositoryFilterLabel(
  repositoryFilter: readonly string[]
): string | undefined {
  const first = repositoryFilter.at(0);
  if (first === undefined) return undefined;
  return repositoryFilter.length === 1
    ? first
    : `${first} +${repositoryFilter.length - 1}`;
}
