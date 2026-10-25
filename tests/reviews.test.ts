import { describe, expect, test } from 'bun:test';
import type { PullRequestReview } from '../src/domain/pull-request.ts';
import {
  latestReviewsByReviewer,
  reviewSummaryDecision,
} from '../src/domain/reviews.ts';

function review(
  author: string,
  state: string,
  hour: number
): PullRequestReview {
  return {
    author,
    state,
    submittedAt: `2026-08-21T${hour}:00:00Z`,
    body: '',
  };
}

const requested = review('reviewer', 'CHANGES_REQUESTED', 10);
const approved = review('reviewer', 'APPROVED', 11);
const otherRequested = review('other-reviewer', 'CHANGES_REQUESTED', 12);

describe('latest review per reviewer', () => {
  test('uses submission time instead of input order and preserves other reviewers', () => {
    expect(
      latestReviewsByReviewer([approved, otherRequested, requested])
    ).toEqual([approved, otherRequested]);
  });

  test('matches GitHub logins case-insensitively and ignores pending reviews', () => {
    expect(
      latestReviewsByReviewer([
        requested,
        { ...approved, author: 'Reviewer' },
        review('reviewer', 'PENDING', 12),
      ])
    ).toEqual([{ ...approved, author: 'Reviewer' }]);
  });

  test('uses the last review when submission timestamps tie', () => {
    const tied = { ...approved, submittedAt: requested.submittedAt };
    expect(latestReviewsByReviewer([requested, tied])).toEqual([tied]);
  });

  test('approving supersedes an earlier change request', () => {
    expect(
      reviewSummaryDecision([requested, approved], 'CHANGES_REQUESTED')
    ).toBe('APPROVED');
  });

  test('another reviewer’s latest change request still blocks approval', () => {
    expect(
      reviewSummaryDecision([requested, approved, otherRequested], 'APPROVED')
    ).toBe('CHANGES_REQUESTED');
  });

  test('requesting changes supersedes an earlier approval', () => {
    expect(
      reviewSummaryDecision(
        [approved, review('reviewer', 'CHANGES_REQUESTED', 12)],
        'APPROVED'
      )
    ).toBe('CHANGES_REQUESTED');
  });

  for (const state of ['COMMENTED', 'DISMISSED']) {
    test(`a latest ${state} review does not revive an older decision`, () => {
      const latest = review('reviewer', state, 12);
      expect(latestReviewsByReviewer([requested, approved, latest])).toEqual([
        latest,
      ]);
      expect(
        reviewSummaryDecision(
          [requested, approved, latest],
          'CHANGES_REQUESTED'
        )
      ).toBe('REVIEW_REQUIRED');
    });
  }

  test('preserves GitHub’s fallback when there is no submitted feedback', () => {
    expect(reviewSummaryDecision([], 'REVIEW_REQUIRED')).toBe(
      'REVIEW_REQUIRED'
    );
    expect(reviewSummaryDecision([], '')).toBe('');
    expect(reviewSummaryDecision([review('reviewer', 'PENDING', 12)], '')).toBe(
      ''
    );
  });
});
