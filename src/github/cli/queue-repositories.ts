import type {
  GitHub,
  GitHubRepository,
  GitHubResult,
  RepositoryCount,
} from '../types.ts';
import {
  array,
  boolean,
  CompatibilityError,
  parseOutput,
  record,
  string,
} from './json.ts';
import { runGh } from './process.ts';
import { listSearchQuery } from './review-queue.ts';

// Only repository names, so a page of 100 costs one rate-limit point and
// returns quickly. ghp's enriched search costs five and takes seconds.
const repositoriesQuery = `
query($searchQuery:String!,$after:String) {
  search(query:$searchQuery,type:ISSUE_ADVANCED,first:100,after:$after) {
    nodes { ... on PullRequest { repository { nameWithOwner } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

type RepositoryPage = {
  readonly names: readonly string[];
  readonly nextCursor: string | null;
};

export function createQueueRepositoriesLoader(
  search: readonly string[]
): GitHub['loadReviewQueueRepositories'] {
  return async function loadReviewQueueRepositories(
    signal,
    list,
    listSearch = search,
    repository
  ) {
    const query = listSearchQuery(list, listSearch, repository);
    const counts = new Map<string, number>();
    let after: string | undefined;
    // GitHub search stops after 1,000 results, so this ends within 10 pages.
    do {
      const page = await searchRepositories(query, after, repository, signal);
      if (!page.ok) return page;
      for (const name of page.value.names) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      after = page.value.nextCursor ?? undefined;
    } while (after !== undefined);
    return {
      ok: true,
      value: [...counts]
        .map(([nameWithOwner, count]): RepositoryCount => ({
          nameWithOwner,
          count,
        }))
        .sort(
          (left, right) =>
            right.count - left.count ||
            left.nameWithOwner.localeCompare(right.nameWithOwner)
        ),
    };
  };
}

async function searchRepositories(
  query: string,
  after: string | undefined,
  repository: GitHubRepository | undefined,
  signal: AbortSignal
): Promise<GitHubResult<RepositoryPage>> {
  const processResult = await runGh(
    [
      'api',
      'graphql',
      ...(repository === undefined ? [] : ['--hostname', repository.hostname]),
      '-f',
      `query=${repositoriesQuery}`,
      '-f',
      `searchQuery=${query}`,
      ...(after === undefined ? [] : ['-f', `after=${after}`]),
    ],
    '',
    'reviewQueueRepositories',
    undefined,
    signal
  );
  if (!processResult.ok) return processResult;
  return parseOutput(
    processResult.value,
    'reviewQueueRepositories',
    parseRepositoryPage
  );
}

function parseRepositoryPage(value: unknown): RepositoryPage {
  const root = record(value, '$');
  const search = record(record(root.data, '$.data').search, '$.data.search');
  const pageInfo = record(search.pageInfo, '$.data.search.pageInfo');
  const hasNextPage = boolean(
    pageInfo.hasNextPage,
    '$.data.search.pageInfo.hasNextPage'
  );
  const nextCursor = hasNextPage
    ? string(pageInfo.endCursor, '$.data.search.pageInfo.endCursor')
    : null;
  if (nextCursor === '')
    throw new CompatibilityError('GitHub search returned an empty next cursor');
  const names = array(search.nodes, '$.data.search.nodes').flatMap(
    (node, index) => {
      const path = `$.data.search.nodes[${index}]`;
      // Search can return non-PR nodes, which have no repository field here.
      if (node === null || !('repository' in record(node, path))) return [];
      const repositoryRecord = record(
        record(node, path).repository,
        `${path}.repository`
      );
      return [
        string(
          repositoryRecord.nameWithOwner,
          `${path}.repository.nameWithOwner`
        ),
      ];
    }
  );
  return { names, nextCursor };
}
