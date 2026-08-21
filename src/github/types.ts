import type {
  PullRequestDetails,
  ReviewQueue,
  ReviewSubmission,
} from '../domain/pull-request.ts';

export type GitHubOperation =
  'reviewQueue' | 'pullRequestDetails' | 'reviewSubmission';

type FailureContext = {
  readonly operation: GitHubOperation;
  readonly url?: string;
};

export type GitHubFailure =
  | (FailureContext & {
      readonly kind: 'startup';
      readonly executable: 'gh';
      readonly diagnostic: string;
    })
  | (FailureContext & {
      readonly kind: 'exit';
      readonly exitCode: number;
      readonly stderr: string;
    })
  | (FailureContext & {
      readonly kind: 'interrupted';
      readonly reason: 'aborted' | 'signal' | 'io';
      readonly signal?: NodeJS.Signals;
      readonly diagnostic?: string;
      readonly stderr: string;
    })
  | (FailureContext & {
      readonly kind: 'malformedData';
      readonly diagnostic: string;
      readonly stderr: string;
    })
  | (FailureContext & {
      readonly kind: 'incompatibleData';
      readonly diagnostic: string;
      readonly stderr: string;
    });

export type GitHubResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: GitHubFailure };

export type GitHub = {
  loadReviewQueue(signal: AbortSignal): Promise<GitHubResult<ReviewQueue>>;
  loadPullRequestDetails(
    url: string,
    signal: AbortSignal
  ): Promise<GitHubResult<PullRequestDetails>>;
  submitReview(
    submission: ReviewSubmission,
    signal: AbortSignal
  ): Promise<GitHubResult<void>>;
};
