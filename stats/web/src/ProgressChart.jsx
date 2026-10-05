import { useMemo, useState } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const APP_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];

const RANGE_PRESETS = [
    { key: '1m', label: '1M', months: 1 },
    { key: '3m', label: '3M', months: 3 },
    { key: '6m', label: '6M', months: 6 },
    { key: 'all', label: 'All', months: null },
];

const DEFAULT_PRESET = '1m';

function subMonths(ms, months) {
    const d = new Date(ms);
    d.setMonth(d.getMonth() - months);
    return d.getTime();
}

function toDateInput(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Line chart of percent-complete over time: one line per app (baseline
 * Angular/Knockout removed, measured at each PR) plus a bold overall line.
 * The visible date range is user-selectable via presets or custom dates.
 */
export default function ProgressChart({ appList, totalSeries }) {
    const { dataMin, dataMax } = useMemo(() => {
        const ts = [];
        for (const a of appList) for (const p of a.series || []) ts.push(p.t);
        for (const [t] of totalSeries) ts.push(t);
        if (!ts.length) return { dataMin: null, dataMax: null };
        return { dataMin: Math.min(...ts), dataMax: Math.max(...ts) };
    }, [appList, totalSeries]);

    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [customFrom, setCustomFrom] = useState(null);
    const [customTo, setCustomTo] = useState(null);

    const { viewMin, viewMax } = useMemo(() => {
        if (dataMax == null) return { viewMin: undefined, viewMax: undefined };
        if (preset === 'custom') {
            return { viewMin: customFrom ?? dataMin, viewMax: customTo ?? dataMax };
        }
        const p = RANGE_PRESETS.find((r) => r.key === preset);
        if (!p || p.months == null) return { viewMin: dataMin, viewMax: dataMax };
        return { viewMin: Math.max(dataMin, subMonths(dataMax, p.months)), viewMax: dataMax };
    }, [preset, customFrom, customTo, dataMin, dataMax]);

    const options = useMemo(() => {
        const appSeries = appList
            .filter((a) => a.series && a.series.length)
            .map((a, i) => ({
                name: a.app,
                data: a.series.map((p) => [p.t, Number(p.percentComplete.toFixed(2))]),
                color: APP_COLORS[i % APP_COLORS.length],
                lineWidth: 1.5,
            }));

        const series = [
            ...appSeries,
            {
                name: 'Overall',
                data: totalSeries.map(([t, p]) => [t, Number(p.toFixed(2))]),
                color: '#e2e8f0',
                lineWidth: 3,
                zIndex: 5,
            },
        ];

        return {
            chart: {
                type: 'line',
                backgroundColor: 'transparent',
                height: 440,
                style: { fontFamily: 'inherit' },
            },
            title: { text: null },
            credits: { enabled: false },
            legend: {
                itemStyle: { color: '#cbd5e1' },
                itemHoverStyle: { color: '#fff' },
            },
            xAxis: {
                type: 'datetime',
                min: viewMin,
                max: viewMax,
                lineColor: '#334155',
                tickColor: '#334155',
                labels: { style: { color: '#94a3b8' } },
            },
            yAxis: {
                min: 0,
                max: 100,
                title: { text: 'Percent complete', style: { color: '#94a3b8' } },
                gridLineColor: '#243044',
                labels: {
                    style: { color: '#94a3b8' },
                    formatter() {
                        return `${this.value}%`;
                    },
                },
            },
            tooltip: {
                backgroundColor: '#1e293b',
                borderColor: '#334155',
                style: { color: '#e2e8f0' },
                xDateFormat: '%e %b %Y',
                pointFormatter() {
                    return `<b>${this.series.name}</b>: ${this.y.toFixed(1)}%<br/>`;
                },
            },
            plotOptions: {
                line: { marker: { enabled: false, radius: 2 } },
            },
            series,
        };
    }, [appList, totalSeries, viewMin, viewMax]);

    return (
        <section>
            <h2>Migration progress over time</h2>
            <p className="subtitle">
                Percent of each app’s baseline Angular / Knockout code removed, measured at
                every pull request from the baseline commit to now.
            </p>

            {dataMax != null && (
                <div className="chart-controls">
                    <div className="range-presets">
                        {RANGE_PRESETS.map((r) => (
                            <button
                                key={r.key}
                                type="button"
                                className={preset === r.key ? 'range-btn active' : 'range-btn'}
                                onClick={() => setPreset(r.key)}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                    <div className="range-custom">
                        <label>
                            From{' '}
                            <input
                                type="date"
                                value={toDateInput(viewMin)}
                                min={toDateInput(dataMin)}
                                max={toDateInput(viewMax)}
                                onChange={(e) => {
                                    if (!e.target.value) return;
                                    setCustomFrom(new Date(e.target.value).getTime());
                                    setCustomTo((prev) => prev ?? viewMax);
                                    setPreset('custom');
                                }}
                            />
                        </label>
                        <label>
                            To{' '}
                            <input
                                type="date"
                                value={toDateInput(viewMax)}
                                min={toDateInput(viewMin)}
                                max={toDateInput(dataMax)}
                                onChange={(e) => {
                                    if (!e.target.value) return;
                                    setCustomTo(new Date(e.target.value).getTime());
                                    setCustomFrom((prev) => prev ?? viewMin);
                                    setPreset('custom');
                                }}
                            />
                        </label>
                    </div>
                </div>
            )}

            <HighchartsReact highcharts={Highcharts} options={options} />
        </section>
    );
}
