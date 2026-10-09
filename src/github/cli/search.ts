import type { PullRequestSummary } from '../../domain/pull-request.ts';
import type { GitHubRepository, GitHubResult } from '../types.ts';
import { runGh } from './process.ts';
import {
  parseOutput,
  record,
  array,
  string,
  boolean,
  integer,
  nullableRecord,
  CompatibilityError,
} from './json.ts';

const queueQuery = (withStacks: boolean): string => `
query($searchQuery:String!,$size:Int!,$after:String) {
  search(query:$searchQuery,type:ISSUE_ADVANCED,first:$size,after:$after) {
    nodes {
      ... on PullRequest {
        number title author { login } isDraft state createdAt updatedAt url
        repository { nameWithOwner }
        labels(first:100) { nodes { name } }
        comments { totalCount }${
          withStacks
            ? `
        stack { number size entries(first:100) { nodes { pullRequest { url headRefName } } } }
        stackEntry { position }`
            : ''
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export type SearchPage = {
  readonly rows: readonly SearchRow[];
  readonly nextCursor: string | null;
};

export type SearchRow = {
  readonly pullRequest: PullRequestSummary;
  /** Every layer in the row's Stack, including the row itself. */
  readonly stackLayers: readonly StackLayerReference[];
};

export type StackLayerReference = {
  readonly url: string;
  readonly headRefName: string;
};

export type SearchPullRequests = (
  query: string,
  size: number,
  after: string | undefined
) => Promise<GitHubResult<SearchPage>>;

export async function runSearch(
  query: string,
  size: number,
  after: string | undefined,
  withStacks: boolean,
  repository: GitHubRepository | undefined,
  signal: AbortSignal
): Promise<GitHubResult<SearchPage>> {
  const processResult = await runGh(
    [
      'api',
      'graphql',
      ...(repository === undefined ? [] : ['--hostname', repository.hostname]),
      '-f',
      `query=${queueQuery(withStacks)}`,
      '-f',
      `searchQuery=${query}`,
      '-F',
      `size=${size}`,
      ...(after === undefined ? [] : ['-f', `after=${after}`]),
    ],
    '',
    'reviewQueue',
    undefined,
    signal,
    repository === undefined
      ? process.env
      : { ...process.env, GH_HOST: repository.hostname }
  );
  if (!processResult.ok) return processResult;
  return parseOutput(processResult.value, 'reviewQueue', (value) =>
    parseSearchPage(value, withStacks)
  );
}

export function inRepositoryScope(
  pullRequest: PullRequestSummary,
  repository: GitHubRepository | undefined
): boolean {
  return (
    repository === undefined ||
    (pullRequest.repository.toLowerCase() ===
      repository.nameWithOwner.toLowerCase() &&
      pullRequest.url
        .toLowerCase()
        .startsWith(`https://${repository.hostname.toLowerCase()}/`))
  );
}

export function searchTerm(term: string): string {
  const colon = term.indexOf(':');
  const prefix = colon < 0 ? '' : term.slice(0, colon + 1);
  const value = term.slice(colon + 1);
  return prefix + (/\s|"/.test(value) ? JSON.stringify(value) : value);
}

function parseSearchPage(value: unknown, withStacks: boolean): SearchPage {
  const root = record(value, '$');
  if (root.errors !== undefined) {
    throw new CompatibilityError('GitHub CLI returned GraphQL search errors');
  }
  const data = record(root.data, '$.data');
  const search = record(data.search, '$.data.search');
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
  const rows = array(search.nodes, '$.data.search.nodes').map(
    (value, index): SearchRow => {
      const path = `$.data.search.nodes[${index}]`;
      const item = record(value, path);
      const labels = record(item.labels, `${path}.labels`);
      const comments = record(item.comments, `${path}.comments`);
      const summary = parseSummary(
        {
          ...item,
          author: item.author === null ? { login: 'ghost' } : item.author,
          state: string(item.state, `${path}.state`).toLowerCase(),
          labels: labels.nodes,
          commentsCount: comments.totalCount,
        },
        path
      );
      const stack = withStacks
        ? nullableRecord(item.stack, `${path}.stack`)
        : null;
      if (stack === null) return { pullRequest: summary, stackLayers: [] };
      const stackEntry = record(item.stackEntry, `${path}.stackEntry`);
      const entries = record(stack.entries, `${path}.stack.entries`);
      return {
        pullRequest: {
          ...summary,
          stack: {
            number: integer(stack.number, `${path}.stack.number`),
            position: integer(
              stackEntry.position,
              `${path}.stackEntry.position`
            ),
            size: integer(stack.size, `${path}.stack.size`),
          },
        },
        stackLayers: array(
          entries.nodes,
          `${path}.stack.entries.nodes`
        ).flatMap((entryValue, entryIndex) => {
          const entryPath = `${path}.stack.entries.nodes[${entryIndex}]`;
          const entry = record(entryValue, entryPath);
          const layer = nullableRecord(
            entry.pullRequest,
            `${entryPath}.pullRequest`
          );
          return layer === null
            ? []
            : [
                {
                  url: string(layer.url, `${entryPath}.pullRequest.url`),
                  headRefName: string(
                    layer.headRefName,
                    `${entryPath}.pullRequest.headRefName`
                  ),
                },
              ];
        }),
      };
    }
  );
  return { rows, nextCursor };
}

function parseSummary(value: unknown, path: string): PullRequestSummary {
  const item = record(value, path);
  const author = record(item.author, `${path}.author`);
  const repository = record(item.repository, `${path}.repository`);
  return {
    number: integer(item.number, `${path}.number`),
    title: string(item.title, `${path}.title`),
    author: string(author.login, `${path}.author.login`),
    isDraft: boolean(item.isDraft, `${path}.isDraft`),
    state: string(item.state, `${path}.state`),
    createdAt: string(item.createdAt, `${path}.createdAt`),
    updatedAt: string(item.updatedAt, `${path}.updatedAt`),
    url: string(item.url, `${path}.url`),
    repository: string(
      repository.nameWithOwner,
      `${path}.repository.nameWithOwner`
    ),
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    labels: array(item.labels, `${path}.labels`).map((label, index) => {
      const labelValue = record(label, `${path}.labels[${index}]`);
      return string(labelValue.name, `${path}.labels[${index}].name`);
    }),
    commentsCount: integer(item.commentsCount, `${path}.commentsCount`),
  };
}
