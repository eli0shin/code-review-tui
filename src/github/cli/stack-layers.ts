import type { GitHubResult } from '../types.ts';
import type {
  SearchRow,
  StackLayerReference,
  SearchPullRequests,
} from './search.ts';

const maximumSearchPageSize = 100;

/**
 * Finds the Stack layers that match the same search but are not on this page.
 * GitHub search has no Stack qualifier, so each Stack's search narrows the
 * query to its layers' head branches and keeps only those exact layer URLs.
 * `head:` also matches longer branch names and fork branches, so ask for a
 * full page to leave room for those extra matches.
 */
export async function loadMissingStackLayers(
  rows: readonly SearchRow[],
  excluded: ReadonlySet<string>,
  query: string,
  searchPullRequests: SearchPullRequests
): Promise<GitHubResult<readonly SearchRow[]>> {
  const shown = new Set([
    ...excluded,
    ...rows.map((row) => row.pullRequest.url),
  ]);
  const missingByStack = new Map<
    string,
    {
      readonly repository: string;
      readonly layers: readonly StackLayerReference[];
    }
  >();
  for (const row of rows) {
    const { stack, repository: stackRepository } = row.pullRequest;
    if (stack === undefined) continue;
    const key = `${stackRepository.toLowerCase()}#${stack.number}`;
    if (missingByStack.has(key)) continue;
    missingByStack.set(key, {
      repository: stackRepository,
      layers: row.stackLayers.filter((layer) => !shown.has(layer.url)),
    });
  }

  const results = await Promise.all(
    [...missingByStack.values()]
      .filter(({ layers }) => layers.length > 0)
      .map(async ({ repository: stackRepository, layers }) => {
        const heads = layers
          // Quote every branch: an unquoted `(` or `)` breaks the OR group.
          .map((layer) => `head:${JSON.stringify(layer.headRefName)}`)
          .join(' OR ');
        const searched = await searchPullRequests(
          `${query} repo:${stackRepository} (${heads})`,
          maximumSearchPageSize,
          undefined
        );
        if (!searched.ok) return searched;
        const layerUrls = new Set(layers.map((layer) => layer.url));
        return {
          ok: true as const,
          value: searched.value.rows.filter((row) =>
            layerUrls.has(row.pullRequest.url)
          ),
        };
      })
  );
  const failureResult = results.find((result) => !result.ok);
  if (failureResult !== undefined) return failureResult;
  return {
    ok: true,
    value: results.flatMap((result) => (result.ok ? result.value : [])),
  };
}
