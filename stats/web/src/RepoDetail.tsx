import { useEffect, useMemo, useState } from 'react';
import { Typography } from '@guardian/stand/Typography';
import { AlertBanner } from '@guardian/stand/AlertBanner';
import { PlatformBadge } from './components/PlatformBadge.tsx';
import RepoProgressChart from './RepoProgressChart.tsx';
import {
  MIGRATED_CATEGORY,
  TO_MIGRATE_CATEGORIES,
  formatNumber,
  type AppStats,
} from './App.tsx';

type RepoDetailProps = {
  name: string;
  repo: AppStats | undefined;
};

function formatCommitDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export default function RepoDetail({ name, repo }: RepoDetailProps) {
  const series = repo?.series ?? [];
  // Default the timeline to the most recent commit.
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, series.length - 1));

  useEffect(() => {
    setSelectedIndex(Math.max(0, series.length - 1));
  }, [series.length]);

  const selected = series[selectedIndex];
  const categories = selected?.categories ?? repo?.categories ?? {};

  // Place commits in proportion to their date, but never closer than MIN_GAP so
  // neighbouring dots can't overlap.
  const positions = useMemo<number[]>(() => {
    const DAY_MS = 86_400_000;
    const PX_PER_DAY = 7;
    const MIN_GAP = 34;
    const minT = series[0]?.t ?? 0;
    const result: number[] = [];
    let prev = -Infinity;
    for (const point of series) {
      const raw = ((point.t - minT) / DAY_MS) * PX_PER_DAY;
      const p = Math.max(raw, prev + MIN_GAP);
      result.push(p);
      prev = p;
    }
    return result;
  }, [series]);
  const trackWidth = Math.max(480, positions[positions.length - 1] ?? 0);

  return (
    <main className="container">
      <p className="back-link">
        <a href="#/">&larr; Back to overview</a>
      </p>

      <header>
        <Typography element="h1" variant="headingLg">
          {name}
        </Typography>
        {repo && (
          <div className="subtitle">
            <PlatformBadge platform={repo.platform} />
          </div>
        )}
      </header>

      {repo ? (
        <>
          <RepoProgressChart repo={repo} />

          {series.length > 0 && (
            <section>
              <Typography element="h2" variant="headingMd">
                Commit timeline
              </Typography>
              <Typography element="p" variant="bodyMd" className="subtitle">
                Select a commit to view its category breakdown below.
              </Typography>
              <div className="commit-timeline">
                <div className="commit-track" style={{ width: `${trackWidth}px` }}>
                  {series.map((point, i) => {
                    const left = positions[i] ?? 0;
                    return (
                      <button
                        key={`${point.commit}-${point.t}`}
                        type="button"
                        className={`commit-node${i === selectedIndex ? ' is-selected' : ''}`}
                        style={{ left: `${left}px` }}
                        onClick={() => setSelectedIndex(i)}
                        title={point.commit || undefined}
                      >
                        <span className="commit-dot" />
                        <span className="commit-date">{formatShortDate(point.t)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          <section>
            <Typography element="h2" variant="headingMd">
              Breakdown by category
            </Typography>
            {selected && (
              <Typography element="p" variant="bodyMd" className="subtitle">
                {formatCommitDate(selected.t)}
                {selected.commit && ` · ${selected.commit.slice(0, 7)}`} ·{' '}
                {selected.percentComplete.toFixed(1)}% complete
              </Typography>
            )}
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Lines</th>
                </tr>
              </thead>
              <tbody>
                {TO_MIGRATE_CATEGORIES.map((c) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td className="num">{formatNumber(categories[c] || 0)}</td>
                  </tr>
                ))}
                <tr>
                  <td>{MIGRATED_CATEGORY}</td>
                  <td className="num migrated-cell">
                    {formatNumber(categories[MIGRATED_CATEGORY] || 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <AlertBanner level="warning">
          <Typography element="p" variant="bodyMd">
            No data found for repository “{name}”.
          </Typography>
        </AlertBanner>
      )}
    </main>
  );
}
