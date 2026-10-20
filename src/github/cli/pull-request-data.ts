import {
  checkIdentity,
  type PullRequestDetails,
  type PullRequestReview,
  type PullRequestCheck,
  type PullRequestIssueComment,
} from '../../domain/pull-request.ts';
import {
  record,
  array,
  string,
  boolean,
  integer,
  incompatible,
} from './json.ts';

export function parsePullRequestDetails(value: unknown): PullRequestDetails {
  const item = record(value, '$');
  const author = record(item.author, '$.author');
  return {
    number: integer(item.number, '$.number'),
    title: string(item.title, '$.title'),
    body: string(item.body, '$.body'),
    author: string(author.login, '$.author.login'),
    state: string(item.state, '$.state'),
    isDraft: boolean(item.isDraft, '$.isDraft'),
    url: string(item.url, '$.url'),
    createdAt: string(item.createdAt, '$.createdAt'),
    updatedAt: string(item.updatedAt, '$.updatedAt'),
    baseRefName: string(item.baseRefName, '$.baseRefName'),
    headRefName: string(item.headRefName, '$.headRefName'),
    additions: integer(item.additions, '$.additions'),
    deletions: integer(item.deletions, '$.deletions'),
    changedFiles: integer(item.changedFiles, '$.changedFiles'),
    labels: array(item.labels, '$.labels').map((label, index) => {
      const labelValue = record(label, `$.labels[${index}]`);
      return string(labelValue.name, `$.labels[${index}].name`);
    }),
    reviewDecision: string(item.reviewDecision, '$.reviewDecision'),
    reviewRequests: array(item.reviewRequests, '$.reviewRequests').map(
      parseReviewRequest
    ),
  };
}

export function parseReviews(value: unknown): readonly PullRequestReview[] {
  const item = record(value, '$');
  return array(item.reviews, '$.reviews').flatMap((reviewValue, index) => {
    const path = `$.reviews[${index}]`;
    const review = record(reviewValue, path);
    if (string(review.state, `${path}.state`) === 'PENDING') return [];
    return [parseReview(reviewValue, index, '$.reviews')];
  });
}

// The rollup lists every run of a check, including reruns and repeated
// workflow triggers. Only the latest run of each check is kept, in the
// position of its first run.
export function parseChecks(value: unknown): readonly PullRequestCheck[] {
  const item = record(value, '$');
  const latest = new Map<
    string,
    { readonly check: PullRequestCheck; readonly startedAt: number }
  >();
  array(item.statusCheckRollup, '$.statusCheckRollup').forEach(
    (value, index) => {
      const path = `$.statusCheckRollup[${index}]`;
      const check = record(value, path);
      const name =
        typeof check.name === 'string'
          ? check.name
          : string(check.context, `${path}.context`);
      let state: string;
      if (typeof check.conclusion === 'string' && check.conclusion !== '') {
        state = check.conclusion;
      } else if (typeof check.state === 'string') {
        state = check.state;
      } else {
        state = string(check.status, `${path}.status`);
      }
      const workflow =
        typeof check.workflowName === 'string' && check.workflowName !== ''
          ? check.workflowName
          : undefined;
      const parsed: PullRequestCheck =
        workflow === undefined ? { name, state } : { workflow, name, state };
      const identity = checkIdentity(parsed);
      const startedAt = checkStartedAt(check.startedAt);
      const previous = latest.get(identity);
      if (previous === undefined || startedAt >= previous.startedAt) {
        latest.set(identity, { check: parsed, startedAt });
      }
    }
  );
  return [...latest.values()].map(({ check }) => check);
}

// A run that has not started yet has no start time (or GitHub CLI's zero
// time) and is the newest run of its check.
function checkStartedAt(value: unknown): number {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) || time <= 0 ? Number.POSITIVE_INFINITY : time;
}

export function parseIssueComments(
  value: unknown
): readonly PullRequestIssueComment[] {
  const item = record(value, '$');
  return array(item.comments, '$.comments').map((value, index) => {
    const path = `$.comments[${index}]`;
    const comment = record(value, path);
    const author = record(comment.author, `${path}.author`);
    return {
      id: string(comment.id, `${path}.id`),
      author: string(author.login, `${path}.author.login`),
      createdAt: string(comment.createdAt, `${path}.createdAt`),
      body: string(comment.body, `${path}.body`),
    };
  });
}

function parseReviewRequest(value: unknown, index: number): string {
  const path = `$.reviewRequests[${index}]`;
  const request = record(value, path);
  if (typeof request.login === 'string') return request.login;
  if (typeof request.name === 'string') return request.name;
  throw incompatible(`${path}.login`, 'a string login or name');
}

function parseReview(
  value: unknown,
  index: number,
  collectionPath: string
): PullRequestReview {
  const path = `${collectionPath}[${index}]`;
  const review = record(value, path);
  const author = record(review.author, `${path}.author`);
  return {
    author: string(author.login, `${path}.author.login`),
    state: string(review.state, `${path}.state`),
    submittedAt: string(review.submittedAt, `${path}.submittedAt`),
    body: string(review.body, `${path}.body`),
  };
}
