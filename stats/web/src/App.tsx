import { useEffect, useMemo, useState } from 'react';
import { Typography } from '@guardian/stand/Typography';
import { AlertBanner } from '@guardian/stand/AlertBanner';
import BurndownChart from './BurndownChart.tsx';
import ProgressChart from './ProgressChart.tsx';
import { StatCard } from './components/StatCard.tsx';
import { ProgressBar } from './components/ProgressBar.tsx';
import { CoverageBar } from './components/CoverageBar.tsx';
import { PlatformBadge } from './components/PlatformBadge.tsx';

const MIGRATED_CATEGORY = 'Migrated (TS/TSX)';
const TO_MIGRATE_CATEGORIES = ['JavaScript', 'HTML templates', 'CSS'];

// Typography defaults to black text; on the dark dashboard we inherit the body colour.
const inheritColor = { color: 'inherit' } as const;
const mutedColor = { color: 'var(--muted)' } as const;

type CsvRow = Record<string, string | undefined>;

type SamplePoint = {
  t: number;
  toMigrate: number;
  percentComplete: number;
};

type AppStats = {
  app: string;
  platform: string;
  categories: Record<string, number>;
  baseline: number;
  toMigrate: number;
  migrated: number;
  migratedFromBaseline: number;
  cucumber: number;
  implemented: number;
  total: number;
  percentComplete: number;
  series: SamplePoint[];
  potentialScenarios: number;
  scenariosPct: number;
  implementedPct: number;
};

type Totals = {
  baseline: number;
  toMigrate: number;
  migrated: number;
  migratedFromBaseline: number;
  cucumber: number;
  implemented: number;
  total: number;
  percentComplete: number;
  potentialScenarios: number;
  scenariosPct: number;
  implementedPct: number;
};

type CategoryTotal = { category: string; lines: number };

type Model = {
  appList: AppStats[];
  totals: Totals;
  categoryTotals: CategoryTotal[];
  totalSeries: Array<[number, number]>;
};

/** Minimal CSV parser for simple, unquoted comma-separated values. */
function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = headerLine.split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return headers.reduce<CsvRow>((row, header, i) => {
      row[header] = cells[i];
      return row;
    }, {});
  });
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-GB');
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, n));
}

type SeriesHolder = { baseline: number; series: SamplePoint[] };

/**
 * Combined progress line: at each timestamp across all apps, carry forward each
 * app's last known to-migrate count and compute (baseline - current) / baseline.
 */
function buildTotalSeries(appList: SeriesHolder[]): Array<[number, number]> {
  const withData = appList.filter((a) => a.baseline > 0 && a.series.length);
  const sumBaseline = withData.reduce((s, a) => s + a.baseline, 0);
  if (!sumBaseline) return [];
  const times = [...new Set(withData.flatMap((a) => a.series.map((p) => p.t)))].sort(
    (x, y) => x - y
  );
  return times.map((t) => {
    let sumCurrent = 0;
    for (const a of withData) {
      let current = a.baseline; // before an app's first sample it sits at baseline (0%)
      for (const p of a.series) {
        if (p.t <= t) current = p.toMigrate;
        else break;
      }
      sumCurrent += current;
    }
    return [t, clampPercent(((sumBaseline - sumCurrent) / sumBaseline) * 100)];
  });
}

export default function App() {
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/report.csv')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load report.csv (${res.status})`);
        return res.text();
      })
      .then((text) => setRows(parseCsv(text)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const model = useMemo<Model | null>(() => {
    if (!rows) return null;

    // The CSV may hold a full per-PR history (many commits per app). Group rows
    // into one sample per (app, commit); tables use the latest sample, the chart
    // uses the whole time series.
    type Sample = {
      t: number | null;
      baseline: number;
      toMigrate: number;
      migrated: number;
      cucumber: number;
      implemented: number;
      categories: Record<string, number>;
    };
    type AppEntry = { app: string; platform: string; samples: Map<string, Sample> };

    const apps = new Map<string, AppEntry>();
    for (const row of rows) {
      const appName = row.app ?? '';
      const lines = Number(row.lines) || 0;
      let appEntry = apps.get(appName);
      if (!appEntry) {
        appEntry = { app: appName, platform: row.platform ?? '', samples: new Map() };
        apps.set(appName, appEntry);
      }
      const key = row.commit || row.timestamp || '';
      let s = appEntry.samples.get(key);
      if (!s) {
        s = {
          t: row.timestamp ? Date.parse(row.timestamp) : null,
          baseline: Number(row.baseline) || 0,
          toMigrate: 0,
          migrated: 0,
          cucumber: 0,
          implemented: 0,
          categories: {},
        };
        appEntry.samples.set(key, s);
      }
      if (row.category) s.categories[row.category] = lines;
      if (row.status === 'migrated') s.migrated += lines;
      else if (row.status === 'added') s.cucumber += lines;
      else if (row.status === 'implemented') s.implemented += lines;
      else s.toMigrate += lines;
    }

    // Progress is measured by how much of the baseline Angular/Knockout code has
    // been removed (baseline - current), not from React added.
    const appList: AppStats[] = [...apps.values()].map((a) => {
      const samples = [...a.samples.values()].sort((x, y) => (x.t || 0) - (y.t || 0));
      const latest = samples[samples.length - 1];
      const baseline = latest?.baseline ?? 0;
      const toMigrate = latest?.toMigrate ?? 0;
      const migrated = latest?.migrated ?? 0;
      const cucumber = latest?.cucumber ?? 0;
      const implemented = latest?.implemented ?? 0;
      const categories = latest?.categories ?? {};
      const series: SamplePoint[] = samples
        .filter((s): s is Sample & { t: number } => s.t != null && s.baseline > 0)
        .map((s) => ({
          t: s.t,
          toMigrate: s.toMigrate,
          percentComplete: clampPercent(((s.baseline - s.toMigrate) / s.baseline) * 100),
        }));
      const total = toMigrate + migrated;
      const percentComplete = baseline
        ? clampPercent(((baseline - toMigrate) / baseline) * 100)
        : 0;
      // Lines of the baseline that have been migrated away (not React added).
      const migratedFromBaseline = Math.max(0, baseline - toMigrate);
      return {
        app: a.app,
        platform: a.platform,
        categories,
        baseline,
        toMigrate,
        migrated,
        migratedFromBaseline,
        cucumber,
        implemented,
        total,
        percentComplete,
        series,
        potentialScenarios: 0,
        scenariosPct: 0,
        implementedPct: 0,
      };
    });

    const totals: Totals = {
      baseline: appList.reduce((s, a) => s + a.baseline, 0),
      toMigrate: appList.reduce((s, a) => s + a.toMigrate, 0),
      migrated: appList.reduce((s, a) => s + a.migrated, 0),
      cucumber: appList.reduce((s, a) => s + a.cucumber, 0),
      implemented: appList.reduce((s, a) => s + a.implemented, 0),
      total: 0,
      percentComplete: 0,
      migratedFromBaseline: 0,
      potentialScenarios: 0,
      scenariosPct: 0,
      implementedPct: 0,
    };
    totals.total = totals.toMigrate + totals.migrated;
    totals.percentComplete = totals.baseline
      ? clampPercent(((totals.baseline - totals.toMigrate) / totals.baseline) * 100)
      : 0;
    totals.migratedFromBaseline = Math.max(0, totals.baseline - totals.toMigrate);

    // Benchmark scenarios-per-line from the completed Restorer migration, then
    // estimate each app's potential scenario count from its baseline LOC.
    const restorer = appList.find((a) => a.app === 'Restorer');
    const scenarioRatio = restorer && restorer.baseline ? restorer.cucumber / restorer.baseline : 0;
    for (const a of appList) {
      a.potentialScenarios = Math.round(scenarioRatio * a.baseline);
      a.scenariosPct = a.potentialScenarios ? clampPercent((a.cucumber / a.potentialScenarios) * 100) : 0;
      a.implementedPct = a.potentialScenarios ? clampPercent((a.implemented / a.potentialScenarios) * 100) : 0;
    }
    totals.potentialScenarios = appList.reduce((s, a) => s + a.potentialScenarios, 0);
    totals.scenariosPct = totals.potentialScenarios
      ? clampPercent((totals.cucumber / totals.potentialScenarios) * 100)
      : 0;
    totals.implementedPct = totals.potentialScenarios
      ? clampPercent((totals.implemented / totals.potentialScenarios) * 100)
      : 0;

    const categoryTotals: CategoryTotal[] = TO_MIGRATE_CATEGORIES.map((category) => ({
      category,
      lines: appList.reduce((s, a) => s + (a.categories[category] || 0), 0),
    }));

    const totalSeries = buildTotalSeries(appList);

    return { appList, totals, categoryTotals, totalSeries };
  }, [rows]);

  if (error) {
    return (
      <main className="container">
        <Typography element="h1" variant="headingLg" theme={inheritColor}>
          Ed Tools Modernisation Stats
        </Typography>
        <AlertBanner level="error">
          <Typography element="p" variant="bodyMd">
            {error}
          </Typography>
          <Typography element="p" variant="bodyMd">
            Generate the data first from the project root: <code>python3 count_frontend_loc.py</code>
          </Typography>
        </AlertBanner>
      </main>
    );
  }

  if (!model) {
    return (
      <main className="container">
        <Typography element="h1" variant="headingLg" theme={inheritColor}>
          Ed Tools Modernisation Stats
        </Typography>
        <Typography element="p" variant="bodyMd" theme={inheritColor}>
          Loading…
        </Typography>
      </main>
    );
  }

  const { appList, totals, categoryTotals, totalSeries } = model;

  return (
    <main className="container">
      <header>
        <Typography element="h1" variant="headingLg" theme={inheritColor}>
          Ed Tools Modernisation Stats
        </Typography>
        <Typography element="p" variant="bodyMd" theme={mutedColor} className="subtitle">
          Frontend lines of code to migrate from Angular / Knockout to React.
        </Typography>
      </header>

      <section className="cards">
        <StatCard label="Lines to migrate" value={formatNumber(totals.toMigrate)} accent="warn" />
        <StatCard label="Baseline" value={formatNumber(totals.baseline)} />
        <StatCard label="Complete" value={`${totals.percentComplete.toFixed(1)}%`} accent="good" />
      </section>

      <section>
        <Typography element="h2" variant="headingMd" theme={inheritColor}>
          Migration summary by application
        </Typography>
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Platform</th>
              <th className="num">Baseline</th>
              <th className="num">To migrate</th>
              <th className="num">Migrated</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {appList.map((a) => (
              <tr key={a.app}>
                <td>{a.app}</td>
                <td>
                  <PlatformBadge platform={a.platform} />
                </td>
                <td className="num">{formatNumber(a.baseline)}</td>
                <td className="num">{formatNumber(a.toMigrate)}</td>
                <td className="num">{formatNumber(a.migratedFromBaseline)}</td>
                <td>
                  <ProgressBar percent={a.percentComplete} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td></td>
              <td className="num">{formatNumber(totals.baseline)}</td>
              <td className="num">{formatNumber(totals.toMigrate)}</td>
              <td className="num">{formatNumber(totals.migratedFromBaseline)}</td>
              <td>
                <ProgressBar percent={totals.percentComplete} />
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section>
        <Typography element="h2" variant="headingMd" theme={inheritColor}>
          Testing summary by application
        </Typography>
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Platform</th>
              <th className="num">Scenarios</th>
              <th className="num">Implemented</th>
              <th className="num">Potential</th>
              <th>Coverage</th>
            </tr>
          </thead>
          <tbody>
            {appList.map((a) => (
              <tr key={a.app}>
                <td>{a.app}</td>
                <td>
                  <PlatformBadge platform={a.platform} />
                </td>
                <td className="num">{formatNumber(a.cucumber)}</td>
                <td className="num">{formatNumber(a.implemented)}</td>
                <td className="num">{formatNumber(a.potentialScenarios)}</td>
                <td>
                  <CoverageBar
                    scenariosPercent={a.scenariosPct}
                    implementedPercent={a.implementedPct}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td></td>
              <td className="num">{formatNumber(totals.cucumber)}</td>
              <td className="num">{formatNumber(totals.implemented)}</td>
              <td className="num">{formatNumber(totals.potentialScenarios)}</td>
              <td>
                <CoverageBar
                  scenariosPercent={totals.scenariosPct}
                  implementedPercent={totals.implementedPct}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section>
        <Typography element="h2" variant="headingMd" theme={inheritColor}>
          Breakdown by category
        </Typography>
        <table>
          <thead>
            <tr>
              <th>App</th>
              {TO_MIGRATE_CATEGORIES.map((c) => (
                <th key={c} className="num">{c}</th>
              ))}
              <th className="num">{MIGRATED_CATEGORY}</th>
            </tr>
          </thead>
          <tbody>
            {appList.map((a) => (
              <tr key={a.app}>
                <td>{a.app}</td>
                {TO_MIGRATE_CATEGORIES.map((c) => (
                  <td key={c} className="num">{formatNumber(a.categories[c] || 0)}</td>
                ))}
                <td className="num migrated-cell">
                  {formatNumber(a.categories[MIGRATED_CATEGORY] || 0)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {categoryTotals.map((c) => (
                <td key={c.category} className="num">{formatNumber(c.lines)}</td>
              ))}
              <td className="num migrated-cell">{formatNumber(totals.migrated)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <ProgressChart appList={appList} totalSeries={totalSeries} />

      <BurndownChart totalToMigrate={totals.toMigrate} />
    </main>
  );
}

export type { AppStats };
