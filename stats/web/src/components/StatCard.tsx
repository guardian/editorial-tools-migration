import { css } from '@emotion/react';
import { Typography } from '@guardian/stand/Typography';

// The dashboard's palette has no exact Stand token equivalent, so we keep the
// legacy CSS custom properties (defined in index.css) for the card chrome and
// the accent/label colours.
type StatCardAccent = 'good' | 'warn';

type StatCardProps = {
  label: string;
  value: string;
  accent?: StatCardAccent;
};

const ACCENT_COLOR: Record<StatCardAccent, string> = {
  good: 'var(--good)',
  warn: 'var(--warn)',
};

const cardCss = css({
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '1.25rem',
});

const labelSpacing = css({ marginTop: '0.25rem' });

const StatCard: React.FunctionComponent<StatCardProps> = ({ label, value, accent }) => (
  <div css={cardCss}>
    <Typography
      element="div"
      variant="heading2Xl"
      {...(accent ? { theme: { color: ACCENT_COLOR[accent] } } : {})}
    >
      {value}
    </Typography>
    <Typography
      element="div"
      variant="bodySm"
      theme={{ color: 'var(--muted)' }}
      cssOverrides={labelSpacing}
    >
      {label}
    </Typography>
  </div>
);

export { StatCard };
