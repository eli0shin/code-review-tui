import type { PullRequestSummary } from '../domain/pull-request.ts';

export type HerdrOperation = 'createTab' | 'runCommand' | 'focusTab';

export type HerdrFailure = {
  readonly operation: HerdrOperation;
  readonly message: string;
  readonly exitCode?: number;
  readonly stderr?: string;
};

export type HerdrResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: HerdrFailure };

export type Herdr = {
  openLumen(pullRequest: PullRequestSummary): Promise<HerdrResult>;
  openReviewCommand(pullRequest: PullRequestSummary): Promise<HerdrResult>;
};
