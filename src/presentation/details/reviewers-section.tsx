import type { PullRequestDetailSources } from '../../github/types.ts';
import { reviewStateColor, type SystemTheme } from '../terminal/theme.ts';
import { DetailSection, Unavailable } from './section.tsx';

export function ReviewersSection({
  metadata,
  reviews,
  theme,
}: {
  readonly metadata: PullRequestDetailSources['metadata'] | undefined;
  readonly reviews: PullRequestDetailSources['reviews'] | undefined;
  readonly theme: SystemTheme | undefined;
}) {
  return (
    <DetailSection title="Reviewers" theme={theme}>
      <RequestedReviewers metadata={metadata} theme={theme} />
      <SubmittedReviewers reviews={reviews} theme={theme} />
    </DetailSection>
  );
}

function RequestedReviewers({
  metadata,
  theme,
}: {
  readonly metadata: PullRequestDetailSources['metadata'] | undefined;
  readonly theme: SystemTheme | undefined;
}) {
  if (metadata === undefined) {
    return <text fg={theme?.textMuted}>Loading requested reviewers…</text>;
  }
  if (!metadata.ok) {
    return <Unavailable label="Review decision and requests" theme={theme} />;
  }
  const { reviewDecision, reviewRequests } = metadata.value;
  return (
    <>
      <text fg={theme?.foreground}>
        Decision:{' '}
        <span fg={reviewStateColor(reviewDecision || 'none', theme)}>
          {reviewDecision || 'none'}
        </span>
      </text>
      <text fg={theme?.foreground}>
        Requested:{' '}
        {reviewRequests.length === 0
          ? 'none'
          : reviewRequests.map((reviewer, index) => (
              <span key={reviewer} fg={theme?.secondary}>
                {index === 0 ? '' : ', '}
                {reviewer}
              </span>
            ))}
      </text>
    </>
  );
}

function SubmittedReviewers({
  reviews,
  theme,
}: {
  readonly reviews: PullRequestDetailSources['reviews'] | undefined;
  readonly theme: SystemTheme | undefined;
}) {
  if (reviews === undefined) {
    return <text fg={theme?.textMuted}>Loading submitted reviewers…</text>;
  }
  if (!reviews.ok) {
    return <Unavailable label="Submitted reviewers" theme={theme} />;
  }
  if (reviews.value.length === 0) {
    return <text fg={theme?.foreground}>Submitted: none</text>;
  }
  return (
    <>
      {reviews.value.map((review) => (
        <text
          key={`${review.author}:${review.submittedAt}:${review.state}:${review.body}`}
          fg={theme?.foreground}
        >
          Submitted: <span fg={theme?.secondary}>{review.author}</span>
          <span fg={theme?.textMuted}> · </span>
          <span fg={reviewStateColor(review.state, theme)}>{review.state}</span>
        </text>
      ))}
    </>
  );
}
