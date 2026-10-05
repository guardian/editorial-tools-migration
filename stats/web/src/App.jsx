import { useEffect, useMemo, useState } from 'react';
import BurndownChart from './BurndownChart.jsx';
import ProgressChart from './ProgressChart.jsx';

const MIGRATED_CATEGORY = 'Migrated (TS/TSX)';
const TO_MIGRATE_CATEGORIES = ['JavaScript', 'HTML templates', 'CSS'];

/** Minimal CSV parser for simple, unquoted comma-separated values. */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return headers.reduce((row, header, i) => {
      row[header] = cells[i];
      return row;
    }, {});
  });
}

function formatNumber(n) {
  return n.toLocaleString('en-GB');
}

function clampPercent(n) {
  return Math.max(0, Math.min(100, n));
}

/**
 * Combined progress line: at each timestamp across all apps, carry forward each
 * app's last known to-migrate count and compute (baseline - current) / baseline.
 */
function buildTotalSeries(appList) {
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
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/report.csv')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load report.csv (${res.status})`);
        return res.text();
      })
      .then((text) => setRows(parseCsv(text)))
      .catch((err) => setError(err.message));
  }, []);

  const model = useMemo(() => {
    if (!rows) return null;

    // The CSV may hold a full per-PR history (many commits per app). Group rows
    // into one sample per (app, commit); tables use the latest sample, the chart
    // uses the whole time series.
    const apps = new Map();
    for (const row of rows) {
      const lines = Number(row.lines) || 0;
      if (!apps.has(row.app)) {
        apps.set(row.app, { app: row.app, platform: row.platform, samples: new Map() });
      }
      const appEntry = apps.get(row.app);
      const key = row.commit || row.timestamp || '';
      if (!appEntry.samples.has(key)) {
        appEntry.samples.set(key, {
          t: row.timestamp ? Date.parse(row.timestamp) : null,
          baseline: Number(row.baseline) || 0,
          toMigrate: 0,
          migrated: 0,
          cucumber: 0,
          categories: {},
        });
      }
      const s = appEntry.samples.get(key);
      s.categories[row.category] = lines;
      if (row.status === 'migrated') s.migrated += lines;
      else if (row.status === 'added') s.cucumber += lines;
      else s.toMigrate += lines;
    }

    // Progress is measured by how much of the baseline Angular/Knockout code has
    // been removed (baseline - current), not from React added.
    const appList = [...apps.values()].map((a) => {
      const samples = [...a.samples.values()].sort((x, y) => (x.t || 0) - (y.t || 0));
      const latest = samples[samples.length - 1];
      const series = samples
        .filter((s) => s.t != null && s.baseline > 0)
        .map((s) => ({
          t: s.t,
          toMigrate: s.toMigrate,
          percentComplete: clampPercent(((s.baseline - s.toMigrate) / s.baseline) * 100),
        }));
      const total = latest.toMigrate + latest.migrated;
      const percentComplete = latest.baseline
        ? clampPercent(((latest.baseline - latest.toMigrate) / latest.baseline) * 100)
        : 0;
      // Lines of the baseline that have been migrated away (not React added).
      const migratedFromBaseline = Math.max(0, latest.baseline - latest.toMigrate);
      return {
        app: a.app,
        platform: a.platform,
        categories: latest.categories,
        baseline: latest.baseline,
        toMigrate: latest.toMigrate,
        migrated: latest.migrated,
        migratedFromBaseline,
        cucumber: latest.cucumber,
        total,
        percentComplete,
        series,
      };
    });

    const totals = {
      baseline: appList.reduce((s, a) => s + a.baseline, 0),
      toMigrate: appList.reduce((s, a) => s + a.toMigrate, 0),
      migrated: appList.reduce((s, a) => s + a.migrated, 0),
      cucumber: appList.reduce((s, a) => s + a.cucumber, 0),
    };
    totals.total = totals.toMigrate + totals.migrated;
    totals.percentComplete = totals.baseline
      ? clampPercent(((totals.baseline - totals.toMigrate) / totals.baseline) * 100)
      : 0;
    totals.migratedFromBaseline = Math.max(0, totals.baseline - totals.toMigrate);

    const categoryTotals = TO_MIGRATE_CATEGORIES.map((category) => ({
      category,
      lines: appList.reduce((s, a) => s + (a.categories[category] || 0), 0),
    }));

    const totalSeries = buildTotalSeries(appList);

    return { appList, totals, categoryTotals, totalSeries };
  }, [rows]);

  if (error) {
    return (
      <main className="container">
        <h1>Ed Tools Modernisation Stats</h1>
        <div className="error">
          <p>{error}</p>
          <p>
            Generate the data first from the project root:
            <br />
            <code>python3 count_frontend_loc.py</code>
          </p>
        </div>
      </main>
    );
  }

  if (!model) {
    return (
      <main className="container">
        <h1>Ed Tools Modernisation Stats</h1>
        <p>Loading…</p>
      </main>
    );
  }

  const { appList, totals, categoryTotals, totalSeries } = model;

  return (
    <main className="container">
      <header>
        <h1>Ed Tools Modernisation Stats</h1>
        <p className="subtitle">
          Frontend lines of code to migrate from Angular / Knockout to React.
        </p>
      </header>

      <section className="cards">
        <StatCard label="Lines to migrate" value={formatNumber(totals.toMigrate)} accent="warn" />
        <StatCard label="Lines migrated (React)" value={formatNumber(totals.migrated)} accent="good" />
        <StatCard label="Baseline" value={formatNumber(totals.baseline)} />
        <StatCard label="Complete" value={`${totals.percentComplete.toFixed(1)}%`} accent="good" />
        <StatCard label="Cucumber scenarios" value={formatNumber(totals.cucumber)} />
      </section>

      <section>
        <h2>Summary by application</h2>
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Platform</th>
              <th className="num">Baseline</th>
              <th className="num">To migrate</th>
              <th className="num">Migrated</th>
              <th className="num">Scenarios</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {appList.map((a) => (
              <tr key={a.app}>
                <td>{a.app}</td>
                <td>
                  <span className={`badge ${a.platform.toLowerCase()}`}>{a.platform}</span>
                </td>
                <td className="num">{formatNumber(a.baseline)}</td>
                <td className="num">{formatNumber(a.toMigrate)}</td>
                <td className="num">{formatNumber(a.migratedFromBaseline)}</td>
                <td className="num">{formatNumber(a.cucumber)}</td>
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
              <td className="num">{formatNumber(totals.cucumber)}</td>
              <td>
                <ProgressBar percent={totals.percentComplete} />
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section>
        <h2>Breakdown by category</h2>
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

function StatCard({ label, value, accent }) {
  return (
    <div className={`card ${accent || ''}`}>
      <div className="card-value">{value}</div>
      <div className="card-label">{label}</div>
    </div>
  );
}

function ProgressBar({ percent }) {
  return (
    <div className="progress" title={`${percent.toFixed(1)}% migrated`}>
      <div className="progress-fill" style={{ width: `${percent}%` }} />
      <span className="progress-label">{percent.toFixed(0)}%</span>
    </div>
  );
}
