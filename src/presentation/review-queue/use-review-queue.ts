import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { tokenizeSearch } from '../../configuration/index.ts';
import type { ReviewQueue } from '../../domain/pull-request.ts';
import type {
  GitHub,
  GitHubFailure,
  GitHubRepository,
  PullRequestList,
  PullRequestPage,
} from '../../github/types.ts';

const emptyReviewQueue: ReviewQueue = [];

/** A visited page's cursor and the Stack layers already shown on earlier pages. */
type PageStart = {
  readonly after: string;
  readonly excludeUrls: readonly string[];
};

export function useReviewQueue({
  github,
  githubSearchText,
  refreshIntervalMinutes,
  pageSize,
  repository,
}: {
  readonly github: GitHub;
  readonly githubSearchText: string;
  readonly refreshIntervalMinutes: number;
  readonly pageSize: number;
  readonly repository: GitHubRepository | undefined;
}) {
  const [cursor, setCursor] = useState(0);
  const [pageStarts, setPageStarts] = useState<readonly PageStart[]>([]);
  const pageStart = pageStarts.at(-1);
  const after = pageStart?.after;
  const [list, setList] = useState<PullRequestList>('reviewQueue');
  const listName = list === 'reviewQueue' ? 'Review Queue' : 'My PRs';
  const [searchText, setSearchText] = useState(githubSearchText);
  const search = useMemo(() => {
    const parsed = tokenizeSearch(searchText);
    if (!parsed.ok) throw new Error(parsed.problem);
    return parsed.value;
  }, [searchText]);

  const query = useQuery<PullRequestPage, GitHubFailure>({
    queryKey: [
      'reviewQueue',
      list,
      list === 'reviewQueue' ? search : null,
      repository,
      pageSize,
      pageStart,
    ],
    async queryFn({ signal }) {
      const result = await github.loadReviewQueue(
        signal,
        list,
        list === 'reviewQueue' ? search : undefined,
        repository,
        { size: pageSize, ...pageStart }
      );
      if (!result.ok) throw result.failure;
      return result.value;
    },
    refetchInterval: refreshIntervalMinutes * 60_000,
  });
  const queue = query.data?.queue ?? emptyReviewQueue;
  if (
    query.isSuccess &&
    !query.isFetching &&
    queue.length === 0 &&
    after !== undefined
  ) {
    resetPage();
  }
  const cursorPosition = Math.min(cursor, Math.max(queue.length - 1, 0));
  if (cursor !== cursorPosition) setCursor(cursorPosition);

  function resetPage(): void {
    setPageStarts([]);
    setCursor(0);
  }

  function refreshFromStart(): void {
    setCursor(0);
    if (after === undefined) void query.refetch();
    else setPageStarts([]);
  }

  function changePage(direction: 'previous' | 'next'): boolean {
    if (direction === 'previous') {
      if (pageStarts.length === 0) return false;
      setPageStarts(pageStarts.slice(0, -1));
    } else {
      if (query.isFetching) return false;
      const nextCursor = query.data?.nextCursor;
      if (!nextCursor || pageStarts.some((start) => start.after === nextCursor))
        return false;
      setPageStarts([
        ...pageStarts,
        {
          after: nextCursor,
          excludeUrls: [
            ...(pageStart?.excludeUrls ?? []),
            ...queue.map((pullRequest) => pullRequest.url),
          ],
        },
      ]);
    }
    setCursor(0);
    return true;
  }

  function toggleList(): void {
    setList((current) =>
      current === 'reviewQueue' ? 'authored' : 'reviewQueue'
    );
    resetPage();
  }

  function applySearch(text: string): ReturnType<typeof tokenizeSearch> {
    const parsed = tokenizeSearch(text);
    if (!parsed.ok) return parsed;
    setSearchText(text);
    resetPage();
    if (
      after === undefined &&
      JSON.stringify(parsed.value) === JSON.stringify(search)
    ) {
      void query.refetch();
    }
    return parsed;
  }

  function moveCursor(direction: 'previous' | 'next'): void {
    const nextPosition = cursorPosition + (direction === 'next' ? 1 : -1);
    if (nextPosition >= 0 && nextPosition < queue.length) {
      setCursor(nextPosition);
    }
  }

  return {
    query,
    queue,
    cursorPosition,
    highlightedPullRequest: queue.at(cursorPosition),
    list,
    listName,
    searchText,
    pageNumber: pageStarts.length + 1,
    resetPage,
    refreshFromStart,
    changePage,
    toggleList,
    applySearch,
    moveCursor,
  };
}
