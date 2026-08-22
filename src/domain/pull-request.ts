export type PullRequestSummary = {
  readonly url: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly isDraft: boolean;
  readonly state: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly labels: readonly string[];
  readonly commentsCount: number;
};

export type PullRequestReview = {
  readonly author: string;
  readonly state: string;
  readonly submittedAt: string;
  readonly body: string;
};

export type PullRequestCheck = {
  readonly name: string;
  readonly state: string;
};

export type PullRequestIssueComment = {
  readonly id: string;
  readonly author: string;
  readonly createdAt: string;
  readonly body: string;
};

export type PullRequestInlineComment = {
  readonly id: string;
  readonly author: string;
  readonly createdAt: string;
  readonly body: string;
  readonly path: string;
  readonly line: number | null;
  readonly startLine: number | null;
  readonly inReplyToId: string | null;
  readonly resolved: boolean;
  readonly outdated: boolean;
};

export type PullRequestDetails = {
  readonly url: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly state: string;
  readonly isDraft: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly labels: readonly string[];
  readonly reviewDecision: string;
  readonly reviewRequests: readonly string[];
};

export type ReviewQueue = readonly PullRequestSummary[];
export type ReviewDecision = 'comment' | 'approve' | 'requestChanges';

export type ReviewSubmission = {
  readonly url: string;
  readonly message: string;
  readonly decision: ReviewDecision;
};
