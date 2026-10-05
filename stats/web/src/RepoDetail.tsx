import { useEffect, useMemo, useRef, useState } from 'react';
import { Typography } from '@guardian/stand/Typography';
import { AlertBanner } from '@guardian/stand/AlertBanner';
import { PlatformBadge } from './components/PlatformBadge.tsx';
import { ProgressBar } from './components/ProgressBar.tsx';
import RepoProgressChart from './RepoProgressChart.tsx';
import {
  TO_MIGRATE_CATEGORIES,
  formatNumber,
  type AppStats,
} from './App.tsx';

type RepoDetailProps = {
  name: string;
  repo: AppStats | undefined;
};

// GitHub repositories backing each app, for commit and PR links.
const REPO_URLS: Record<string, string> = {
  Workflow: 'https://github.com/guardian/workflow-frontend',
  Grid: 'https://github.com/guardian/grid',
  Restorer: 'https://github.com/guardian/flexible-restorer',
  Fronts: 'https://github.com/guardian/facia-tool',
  'Story Packages': 'https://github.com/guardian/story-packages',
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
  const cucumber = selected?.cucumber ?? repo?.cucumber ?? 0;
  const implemented = selected?.implemented ?? repo?.implemented ?? 0;
  const potential = repo?.potentialScenarios ?? 0;
  const featuresLeftToWrite = Math.max(0, potential - cucumber);
  const featuresLeftToImplement = Math.max(0, potential - implemented);
  const firstCategories = series[0]?.categories ?? {};
  const repoUrl = REPO_URLS[name];

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

  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollDirRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Start fully scrolled to the right so the latest commit is in view.
  useEffect(() => {
    const el = timelineRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [trackWidth]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const EDGE_ZONE = 64;
  const SCROLL_SPEED = 14;

  const stepScroll = () => {
    const el = timelineRef.current;
    if (el && scrollDirRef.current !== 0) {
      el.scrollLeft += scrollDirRef.current * SCROLL_SPEED;
      rafRef.current = requestAnimationFrame(stepScroll);
    } else {
      rafRef.current = null;
    }
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const dir = x < EDGE_ZONE ? -1 : x > rect.width - EDGE_ZONE ? 1 : 0;
    scrollDirRef.current = dir;
    if (dir !== 0 && rafRef.current == null) {
      rafRef.current = requestAnimationFrame(stepScroll);
    }
  };

  const handleTimelineMouseLeave = () => {
    scrollDirRef.current = 0;
  };

  const handleTimelineKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = Math.max(
      0,
      Math.min(series.length - 1, selectedIndex + (e.key === 'ArrowLeft' ? -1 : 1))
    );
    setSelectedIndex(next);
    const node = timelineRef.current?.querySelectorAll<HTMLButtonElement>('.commit-node')[next];
    node?.focus();
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

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
          <RepoProgressChart
            repo={repo}
            highlight={
              selected ? { t: selected.t, commit: selected.commit, pr: selected.pr } : null
            }
          />

          {series.length > 0 && (
            <section>
              <Typography element="h2" variant="headingMd">
                Commit timeline
              </Typography>
              <Typography element="p" variant="bodyMd" className="subtitle">
                Select a commit to view its category breakdown below.
              </Typography>
              <div
                className="commit-timeline"
                ref={timelineRef}
                onMouseMove={handleTimelineMouseMove}
                onMouseLeave={handleTimelineMouseLeave}
                onKeyDown={handleTimelineKeyDown}
              >
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
                        onMouseEnter={() => setSelectedIndex(i)}
                        onFocus={() => setSelectedIndex(i)}
                        title={point.commit || undefined}
                      >
                        <span className="commit-dot" />
                        <span className="commit-date">
                          {formatShortDate(point.t)}
                          {point.pr && ` · #${point.pr}`}
                        </span>
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
                {selected.commit && (
                  <>
                    {' · '}
                    {repoUrl ? (
                      <a
                        href={`${repoUrl}/commit/${selected.commit}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {selected.commit.slice(0, 7)}
                      </a>
                    ) : (
                      selected.commit.slice(0, 7)
                    )}
                  </>
                )}
                {selected.pr && repoUrl && (
                  <>
                    {' · '}
                    <a
                      href={`${repoUrl}/pull/${selected.pr}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PR #{selected.pr}
                    </a>
                  </>
                )}
                {' · '}
                {selected.percentComplete.toFixed(1)}% complete
              </Typography>
            )}
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">To migrate</th>
                  <th className="num">Completed</th>
                  <th>% migrated</th>
                </tr>
              </thead>
              <tbody>
                {TO_MIGRATE_CATEGORIES.map((c) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td className="num">{formatNumber(categories[c] || 0)}</td>
                    <td className="num migrated-cell">
                      {formatNumber(Math.max(0, (firstCategories[c] || 0) - (categories[c] || 0)))}
                    </td>
                    <td>
                      <ProgressBar
                        percent={
                          (firstCategories[c] || 0) > 0
                            ? Math.min(
                                100,
                                Math.max(
                                  0,
                                  (((firstCategories[c] || 0) - (categories[c] || 0)) /
                                    (firstCategories[c] || 0)) *
                                    100
                                )
                              )
                            : 0
                        }
                      />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>Features defined</td>
                  <td className="num">{formatNumber(featuresLeftToWrite)}</td>
                  <td className="num migrated-cell">{formatNumber(cucumber)}</td>
                  <td>
                    <ProgressBar
                      percent={potential > 0 ? Math.min(100, (cucumber / potential) * 100) : 0}
                    />
                  </td>
                </tr>
                <tr>
                  <td>Features implemented</td>
                  <td className="num">{formatNumber(featuresLeftToImplement)}</td>
                  <td className="num migrated-cell">{formatNumber(implemented)}</td>
                  <td>
                    <ProgressBar
                      percent={potential > 0 ? Math.min(100, (implemented / potential) * 100) : 0}
                    />
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
