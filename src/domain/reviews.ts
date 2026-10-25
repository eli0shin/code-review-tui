import type { PullRequestReview } from './pull-request.ts';

/** Keep one submitted review per reviewer, in first-seen reviewer order. */
export function latestReviewsByReviewer(
  reviews: readonly PullRequestReview[]
): readonly PullRequestReview[] {
  const latest = new Map<string, PullRequestReview>();
  for (const review of reviews) {
    if (review.state === 'PENDING') continue;
    const identity = review.author.toLowerCase();
    const previous = latest.get(identity);
    if (
      previous === undefined ||
      Date.parse(review.submittedAt) >= Date.parse(previous.submittedAt)
    ) {
      latest.set(identity, review);
    }
  }
  return [...latest.values()];
}

/** Summarize current reviewer feedback, not branch-protection eligibility. */
export function reviewSummaryDecision(
  reviews: readonly PullRequestReview[],
  fallback: string
): string {
  const latest = latestReviewsByReviewer(reviews);
  if (latest.some((review) => review.state === 'CHANGES_REQUESTED')) {
    return 'CHANGES_REQUESTED';
  }
  if (latest.some((review) => review.state === 'APPROVED')) return 'APPROVED';
  if (
    latest.length > 0 &&
    (fallback === 'CHANGES_REQUESTED' || fallback === 'APPROVED')
  ) {
    return 'REVIEW_REQUIRED';
  }
  return fallback;
}
