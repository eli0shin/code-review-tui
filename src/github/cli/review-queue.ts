import { groupStacks } from '../../domain/stack-order.ts';
import type {
  GitHub,
  GitHubRepository,
  PullRequestList,
  PullRequestPageRequest,
} from '../types.ts';
import {
  runSearch,
  searchTerm,
  inRepositoryScope,
  type SearchPage,
  type SearchRow,
  type SearchPullRequests,
} from './search.ts';
import { loadMissingStackLayers } from './stack-layers.ts';

const authoredSearch = ['is:pr', 'author:@me', 'state:open'] as const;

/**
 * Matches gh search's keyword quoting and intersects the intact query with PR
 * type, scope, and the repository filter outside its Boolean expression.
 */
export function listSearchQuery(
  list: PullRequestList,
  search: readonly string[],
  repository: GitHubRepository | undefined,
  repositories: readonly string[] = []
): string {
  const listSearch = list === 'authored' ? authoredSearch : search;
  const scope =
    repository === undefined ? '' : ` repo:${repository.nameWithOwner}`;
  const filterTerms = repositories.map((name) => `repo:${name}`);
  const filter =
    filterTerms.length === 0
      ? ''
      : filterTerms.length === 1
        ? ` ${filterTerms[0]}`
        : ` (${filterTerms.join(' OR ')})`;
  return `( ${listSearch.map(searchTerm).join(' ')} ) type:pr${scope}${filter}`;
}

export function createReviewQueueLoader(
  search: readonly string[]
): GitHub['loadReviewQueue'] {
  const searchArguments = [...search];

  return async function loadReviewQueue(
    signal,
    list: PullRequestList = 'reviewQueue',
    search = searchArguments,
    repository?: GitHubRepository,
    page: PullRequestPageRequest = { size: 25 },
    repositories: readonly string[] = []
  ) {
    const query = listSearchQuery(list, search, repository, repositories);
    const searchPullRequests: SearchPullRequests = (searchQuery, size, after) =>
      runSearch(searchQuery, size, after, repository, signal, page.fresh);
    const excluded = new Set(page.excludeUrls);
    const shownRows = (searchPage: SearchPage): readonly SearchRow[] =>
      searchPage.rows.filter(
        (row) =>
          inRepositoryScope(row.pullRequest, repository) &&
          !excluded.has(row.pullRequest.url)
      );

    let after = page.after;
    let searchPage: SearchPage;
    let rows: readonly SearchRow[];
    // Skip past a page whose rows were all pulled onto earlier pages, so an
    // empty result still means the search has no more rows.
    do {
      const searched = await searchPullRequests(query, page.size, after);
      if (!searched.ok) return searched;
      searchPage = searched.value;
      rows = shownRows(searchPage);
      after = searchPage.nextCursor ?? undefined;
    } while (
      rows.length === 0 &&
      searchPage.rows.length > 0 &&
      searchPage.nextCursor !== null
    );

    const stackLayers = await loadMissingStackLayers(
      rows,
      excluded,
      query,
      searchPullRequests
    );
    if (!stackLayers.ok) return stackLayers;
    return {
      ok: true,
      value: {
        queue: groupStacks(
          [...rows, ...stackLayers.value].map((row) => row.pullRequest)
        ),
        nextCursor: searchPage.nextCursor,
      },
    };
  };
}
