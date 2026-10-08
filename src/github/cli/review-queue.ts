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
import { enrichReviewQueue } from './queue-enrichment.ts';

// GitHub Enterprise Server does not have native Stacks yet.
const missingStackFields =
  /Field 'stack(Entry)?' doesn't exist on type 'PullRequest'/;
const authoredSearch = ['is:pr', 'author:@me', 'state:open'] as const;

export function createReviewQueueLoader(
  search: readonly string[]
): GitHub['loadReviewQueue'] {
  const searchArguments = [...search];
  // Hosts that rejected the Stack fields. `''` is GitHub CLI's default host.
  const hostsWithoutStacks = new Set<string>();

  return async function loadReviewQueue(
    signal,
    list: PullRequestList = 'reviewQueue',
    search = searchArguments,
    repository?: GitHubRepository,
    page: PullRequestPageRequest = { size: 25 }
  ) {
    const listSearch = list === 'authored' ? authoredSearch : search;
    // Match gh search's keyword quoting and intersect the intact query with
    // PR type and scope outside its Boolean expression.
    const query = `( ${listSearch.map(searchTerm).join(' ')} ) type:pr${repository === undefined ? '' : ` repo:${repository.nameWithOwner}`}`;
    const host = repository?.hostname ?? '';
    const searchPullRequests: SearchPullRequests = async (
      searchQuery,
      size,
      after
    ) => {
      if (!hostsWithoutStacks.has(host)) {
        const searched = await runSearch(
          searchQuery,
          size,
          after,
          true,
          repository,
          signal
        );
        if (
          searched.ok ||
          searched.failure.kind !== 'exit' ||
          !missingStackFields.test(searched.failure.stderr)
        )
          return searched;
        hostsWithoutStacks.add(host);
      }
      return runSearch(searchQuery, size, after, false, repository, signal);
    };
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
    const enriched = await enrichReviewQueue(
      groupStacks(
        [...rows, ...stackLayers.value].map((row) => row.pullRequest)
      ),
      signal
    );
    return enriched.ok
      ? {
          ok: true,
          value: {
            queue: enriched.value,
            nextCursor: searchPage.nextCursor,
          },
        }
      : enriched;
  };
}
