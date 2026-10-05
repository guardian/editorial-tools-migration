import { css } from '@emotion/react';
import type { SerializedStyles } from '@emotion/react';

// The dashboard's dark palette has no exact Stand token equivalent, so we keep
// the legacy CSS custom properties (defined in index.css) as the source of truth.
type StatCardAccent = 'good' | 'warn';

type StatCardProps = {
  label: string;
  value: string;
  accent?: StatCardAccent;
};

const cardCss = css({
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '1.25rem',
});

const valueCss = css({
  fontSize: '1.9rem',
  fontWeight: 700,
});

const accentCss: Record<StatCardAccent, SerializedStyles> = {
  good: css({ color: 'var(--good)' }),
  warn: css({ color: 'var(--warn)' }),
};

const labelCss = css({
  color: 'var(--muted)',
  fontSize: '0.85rem',
  marginTop: '0.25rem',
});

const StatCard: React.FunctionComponent<StatCardProps> = ({ label, value, accent }) => (
  <div css={cardCss}>
    <div css={[valueCss, accent ? accentCss[accent] : undefined]}>{value}</div>
    <div css={labelCss}>{label}</div>
  </div>
);

export { StatCard };
