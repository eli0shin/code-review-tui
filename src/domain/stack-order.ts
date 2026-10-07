import type { PullRequestSummary, ReviewQueue } from './pull-request.ts';

/**
 * Keeps the given order, except that every Stack's layers move up to where
 * the Stack first appears, with the highest layer on top.
 */
export function groupStacks(queue: ReviewQueue): ReviewQueue {
  const layersByStack = new Map<string, PullRequestSummary[]>();
  for (const pullRequest of queue) {
    const key = stackKey(pullRequest);
    if (key === undefined) continue;
    const layers = layersByStack.get(key);
    if (layers === undefined) layersByStack.set(key, [pullRequest]);
    else layers.push(pullRequest);
  }
  return queue.flatMap((pullRequest) => {
    const key = stackKey(pullRequest);
    if (key === undefined) return [pullRequest];
    const layers = layersByStack.get(key);
    if (layers === undefined) return [];
    layersByStack.delete(key);
    return layers.toSorted(
      (first, second) =>
        (second.stack?.position ?? 0) - (first.stack?.position ?? 0)
    );
  });
}

function stackKey(pullRequest: PullRequestSummary): string | undefined {
  return pullRequest.stack === undefined
    ? undefined
    : `${pullRequest.repository.toLowerCase()}#${pullRequest.stack.number}`;
}
