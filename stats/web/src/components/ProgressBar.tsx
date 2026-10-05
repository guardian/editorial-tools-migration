import { css } from '@emotion/react';

type ProgressBarProps = {
  percent: number;
};

const trackCss = css({
  position: 'relative',
  height: 20,
  minWidth: 120,
  background: 'var(--panel-2)',
  borderRadius: 999,
  overflow: 'hidden',
});

const fillCss = css({
  height: '100%',
  background: 'linear-gradient(90deg, #16a34a, var(--good))',
  transition: 'width 0.4s ease',
});

const labelCss = css({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.72rem',
  fontWeight: 600,
});

const ProgressBar: React.FunctionComponent<ProgressBarProps> = ({ percent }) => (
  <div css={trackCss} title={`${percent.toFixed(1)}% migrated`}>
    <div css={fillCss} style={{ width: `${percent}%` }} />
    <span css={labelCss}>{percent.toFixed(0)}%</span>
  </div>
);

export { ProgressBar };
