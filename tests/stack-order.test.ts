import { expect, test } from 'bun:test';
import type {
  PullRequestStackLayer,
  PullRequestSummary,
} from '../src/domain/pull-request.ts';
import { groupStacks } from '../src/domain/stack-order.ts';

test('moves each Stack to its first row, top layer first, and keeps other rows in order', () => {
  const queue = [
    row('acme/widgets', 1),
    row('acme/widgets', 21, { number: 20, position: 1, size: 2 }),
    row('acme/other', 31, { number: 20, position: 2, size: 2 }),
    row('acme/widgets', 2),
    row('acme/widgets', 22, { number: 20, position: 2, size: 2 }),
    row('acme/other', 30, { number: 20, position: 1, size: 2 }),
  ];

  expect(groupStacks(queue).map((pullRequest) => pullRequest.number)).toEqual([
    1, 22, 21, 31, 30, 2,
  ]);
});

function row(
  repository: string,
  number: number,
  stack?: PullRequestStackLayer
): PullRequestSummary {
  return {
    url: `https://github.com/${repository}/pull/${number}`,
    repository,
    number,
    title: `PR ${number}`,
    author: 'octocat',
    isDraft: false,
    state: 'open',
    createdAt: '2026-08-20T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    labels: [],
    commentsCount: 0,
    ...(stack === undefined ? {} : { stack }),
  };
}
