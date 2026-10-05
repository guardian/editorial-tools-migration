import { useMemo, useState } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { Typography } from '@guardian/stand/Typography';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Return the timestamp `workDays` working days (Mon–Fri) after startMs. */
function addWorkingDays(startMs: number, workDays: number): number {
  const d = new Date(startMs);
  let added = 0;
  while (added < workDays) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1; // skip Sun (0) and Sat (6)
  }
  return d.getTime();
}

// Fixed graph window: 18 months, and roughly 5/7 of those days are working days.
const WINDOW_MONTHS = 18;
const WINDOW_WORKING_DAYS = Math.round((WINDOW_MONTHS / 12) * 261); // ~261 working days/year

function addMonths(startMs: number, months: number): number {
  const d = new Date(startMs);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

type BurndownChartProps = {
  totalToMigrate: number;
};

/**
 * Burndown chart: projects when the remaining "lines to migrate" reach zero
 * given a developer velocity (lines/day) controlled by the slider. Work only
 * happens on the 5 working days per week, so weekends push the dates out.
 * The time axis is fixed to an 18-month window; the velocity slider changes
 * how far the projection line burns down within that window.
 */
export default function BurndownChart({ totalToMigrate }: BurndownChartProps) {
  const [velocity, setVelocity] = useState(500);

  const startMs = useMemo(() => Date.now(), []);
  const windowEndMs = useMemo(() => addMonths(startMs, WINDOW_MONTHS), [startMs]);
  const deadlineMs = useMemo(() => addMonths(startMs, 17), [startMs]);

  const { series, completionMs, workDays } = useMemo<{
    series: Array<[number, number]>;
    completionMs: number | null;
    workDays: number;
  }>(() => {
    if (velocity <= 0) {
      return { series: [[startMs, totalToMigrate]], completionMs: null, workDays: Infinity };
    }

    const days = Math.ceil(totalToMigrate / velocity);
    // Only plot as far as the visible window; sample ~60 points across it.
    const lastDay = Math.min(days, WINDOW_WORKING_DAYS);
    const step = Math.max(1, Math.ceil(lastDay / 60));
    const points: Array<[number, number]> = [];
    for (let day = 0; day <= lastDay; day += step) {
      const remaining = Math.max(0, totalToMigrate - velocity * day);
      points.push([addWorkingDays(startMs, day), remaining]);
    }
    // If the migration completes inside the window, land exactly on zero.
    if (days <= WINDOW_WORKING_DAYS) {
      const last = points[points.length - 1];
      if (last && last[1] !== 0) {
        points.push([addWorkingDays(startMs, days), 0]);
      }
    } else {
      // Otherwise extend the line to the window edge so it fills the graph.
      const remainingAtEdge = Math.max(0, totalToMigrate - velocity * WINDOW_WORKING_DAYS);
      points.push([windowEndMs, remainingAtEdge]);
    }

    return { series: points, completionMs: addWorkingDays(startMs, days), workDays: days };
  }, [velocity, totalToMigrate, startMs, windowEndMs]);

  const options = useMemo<Highcharts.Options>(
    () => ({
      chart: {
        type: 'area',
        backgroundColor: 'transparent',
        height: 420,
        style: { fontFamily: 'inherit' },
      },
      title: { text: '' },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime',
        min: startMs,
        max: windowEndMs,
        lineColor: '#334155',
        tickColor: '#334155',
        labels: { style: { color: '#94a3b8' } },
        plotLines: [
          {
            value: deadlineMs,
            color: '#f43f5e',
            width: 2,
            dashStyle: 'Dash',
            zIndex: 5,
            label: {
              text: `17-month target (${formatDate(deadlineMs)})`,
              rotation: 0,
              align: 'right',
              x: -8,
              y: 16,
              style: { color: '#f43f5e', fontWeight: '600' },
            },
          },
        ],
      },
      yAxis: {
        title: { text: 'Lines remaining to migrate', style: { color: '#94a3b8' } },
        min: 0,
        gridLineColor: '#243044',
        labels: {
          style: { color: '#94a3b8' },
          formatter() {
            return Number(this.value).toLocaleString('en-GB');
          },
        },
      },
      tooltip: {
        backgroundColor: '#1e293b',
        borderColor: '#334155',
        style: { color: '#e2e8f0' },
        headerFormat: '',
        pointFormatter() {
          return `<b>${formatDate(Number(this.x))}</b><br/>${(this.y ?? 0).toLocaleString(
            'en-GB'
          )} lines remaining`;
        },
      },
      plotOptions: {
        area: {
          lineColor: '#38bdf8',
          lineWidth: 2,
          marker: { enabled: false, radius: 3 },
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'rgba(56, 189, 248, 0.35)'],
              [1, 'rgba(56, 189, 248, 0.02)'],
            ],
          },
        },
      },
      series: [{ type: 'area', name: 'Lines remaining', data: series }],
    }),
    [series, startMs, windowEndMs, deadlineMs]
  );

  return (
    <section>
      <Typography element="h2" variant="headingMd">
        Migration burndown projection
      </Typography>

      {/* No Stand slider component exists, so the velocity control stays a raw range input. */}
      <div className="velocity-control">
        <label htmlFor="velocity">
          Developer velocity: <strong>{velocity.toLocaleString('en-GB')}</strong> lines / day
        </label>
        <input
          id="velocity"
          type="range"
          min="0"
          max="2000"
          step="50"
          value={velocity}
          onChange={(e) => setVelocity(Number(e.target.value))}
        />
        <div className="velocity-scale">
          <span>0</span>
          <span>2,000</span>
        </div>
      </div>

      <div className="projection-summary">
        {velocity <= 0 ? (
          <Typography element="p" variant="bodyMd" className="warn-text">
            At 0 lines/day the migration never completes — increase the velocity.
          </Typography>
        ) : (
          <Typography element="p" variant="bodyMd">
            At <strong>{velocity.toLocaleString('en-GB')}</strong> lines/day over a 5-day
            working week, the <strong>{totalToMigrate.toLocaleString('en-GB')}</strong> remaining
            lines take <strong>{workDays.toLocaleString('en-GB')}</strong> working days (
            {(workDays / 5).toFixed(1)} weeks) — projected completion{' '}
            <strong>{completionMs != null ? formatDate(completionMs) : '—'}</strong>
            {completionMs != null && completionMs > windowEndMs && (
              <span className="warn-text"> (beyond the 18-month window)</span>
            )}
            .
          </Typography>
        )}
      </div>

      <HighchartsReact highcharts={Highcharts} options={options} />
    </section>
  );
}
