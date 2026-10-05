import { css } from '@emotion/react';

type CoverageBarProps = {
  scenariosPercent: number;
  implementedPercent: number;
};

const trackCss = css({
  position: 'relative',
  height: 20,
  minWidth: 120,
  background: 'var(--panel-2)',
  borderRadius: 999,
  overflow: 'hidden',
});

const fillBase = css({
  position: 'absolute',
  top: 0,
  left: 0,
  height: '100%',
  borderRadius: 999,
  transition: 'width 0.4s ease',
});

const scenariosCss = css({ background: 'rgba(56, 189, 248, 0.35)' });
const implementedCss = css({ background: 'linear-gradient(90deg, #16a34a, var(--good))' });

const labelCss = css({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.72rem',
  fontWeight: 600,
});

// Nested bar against potential scenarios: written (outer) with implemented (inner).
const CoverageBar: React.FunctionComponent<CoverageBarProps> = ({
  scenariosPercent,
  implementedPercent,
}) => (
  <div
    css={trackCss}
    title={`${scenariosPercent.toFixed(1)}% of potential scenarios written, ${implementedPercent.toFixed(1)}% implemented`}
  >
    <div css={[fillBase, scenariosCss]} style={{ width: `${scenariosPercent}%` }} />
    <div css={[fillBase, implementedCss]} style={{ width: `${implementedPercent}%` }} />
    <span css={labelCss}>{scenariosPercent.toFixed(0)}%</span>
  </div>
);

export { CoverageBar };
