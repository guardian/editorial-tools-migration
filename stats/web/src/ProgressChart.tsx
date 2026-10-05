import { useMemo, useState } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { Button } from '@guardian/stand/Button';
import { DatePicker } from '@guardian/stand/DatePicker';
import { Typography } from '@guardian/stand/Typography';
import { CalendarDate, getLocalTimeZone, type DateValue } from '@internationalized/date';
import type { AppStats } from './App.tsx';

const APP_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];

type PresetKey = '1m' | '3m' | '6m' | 'all' | 'custom';

const RANGE_PRESETS: Array<{ key: PresetKey; label: string; months: number | null }> = [
    { key: '1m', label: '1M', months: 1 },
    { key: '3m', label: '3M', months: 3 },
    { key: '6m', label: '6M', months: 6 },
    { key: 'all', label: 'All', months: null },
];

const DEFAULT_PRESET: PresetKey = '1m';

function subMonths(ms: number, months: number): number {
    const d = new Date(ms);
    d.setMonth(d.getMonth() - months);
    return d.getTime();
}

function msToDate(ms: number): CalendarDate {
    const d = new Date(ms);
    return new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function dateToMs(value: DateValue): number {
    return value.toDate(getLocalTimeZone()).getTime();
}

type ProgressChartProps = {
    appList: AppStats[];
    totalSeries: Array<[number, number]>;
};

/**
 * Line chart of percent-complete over time: one line per app (baseline
 * Angular/Knockout removed, measured at each PR) plus a bold overall line.
 * The visible date range is user-selectable via presets or custom dates.
 */
export default function ProgressChart({ appList, totalSeries }: ProgressChartProps) {
    const { dataMin, dataMax } = useMemo(() => {
        const ts: number[] = [];
        for (const a of appList) for (const p of a.series || []) ts.push(p.t);
        for (const [t] of totalSeries) ts.push(t);
        if (!ts.length) return { dataMin: null, dataMax: null };
        return { dataMin: Math.min(...ts), dataMax: Math.max(...ts) };
    }, [appList, totalSeries]);

    const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
    const [customFrom, setCustomFrom] = useState<number | null>(null);
    const [customTo, setCustomTo] = useState<number | null>(null);

    const { viewMin, viewMax } = useMemo<{ viewMin: number | undefined; viewMax: number | undefined }>(() => {
        if (dataMax == null || dataMin == null) return { viewMin: undefined, viewMax: undefined };
        if (preset === 'custom') {
            return { viewMin: customFrom ?? dataMin, viewMax: customTo ?? dataMax };
        }
        const p = RANGE_PRESETS.find((r) => r.key === preset);
        if (!p || p.months == null) return { viewMin: dataMin, viewMax: dataMax };
        return { viewMin: Math.max(dataMin, subMonths(dataMax, p.months)), viewMax: dataMax };
    }, [preset, customFrom, customTo, dataMin, dataMax]);

    const options = useMemo<Highcharts.Options>(() => {
        const appSeries = appList
            .filter((a) => a.series && a.series.length)
            .map((a, i) => ({
                type: 'line' as const,
                name: a.app,
                data: a.series.map((p) => [p.t, Number(p.percentComplete.toFixed(2))]),
                color: APP_COLORS[i % APP_COLORS.length] ?? '#38bdf8',
                lineWidth: 1.5,
            }));

        const series: Highcharts.SeriesOptionsType[] = [
            ...appSeries,
            {
                type: 'line' as const,
                name: 'Overall',
                data: totalSeries.map(([t, p]) => [t, Number(p.toFixed(2))]),
                color: '#0f172a',
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
            title: { text: '' },
            credits: { enabled: false },
            legend: {
                itemStyle: { color: '#334155' },
                itemHoverStyle: { color: '#0f172a' },
            },
            xAxis: {
                type: 'datetime',
                min: viewMin ?? null,
                max: viewMax ?? null,
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
                    return `<b>${this.series.name}</b>: ${(this.y ?? 0).toFixed(1)}%<br/>`;
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
            <Typography element="h2" variant="headingMd">
                Migration progress over time
            </Typography>
            <Typography element="p" variant="bodyMd" className="subtitle">
                Percent of each app’s baseline Angular / Knockout code removed, measured at
                every pull request from the baseline commit to now.
            </Typography>

            {dataMax != null && dataMin != null && (
                <div className="chart-controls">
                    <div className="range-presets">
                        {RANGE_PRESETS.map((r) => (
                            <Button
                                key={r.key}
                                size="xs"
                                variant={preset === r.key ? 'primary' : 'tertiary'}
                                onPress={() => setPreset(r.key)}
                            >
                                {r.label}
                            </Button>
                        ))}
                    </div>
                    <div className="range-custom">
                        <DatePicker
                            label="From"
                            value={viewMin != null ? msToDate(viewMin) : null}
                            minValue={msToDate(dataMin)}
                            maxValue={viewMax != null ? msToDate(viewMax) : null}
                            onChange={(value) => {
                                if (!value) return;
                                setCustomFrom(dateToMs(value));
                                setCustomTo((prev) => prev ?? viewMax ?? dataMax);
                                setPreset('custom');
                            }}
                        />
                        <DatePicker
                            label="To"
                            value={viewMax != null ? msToDate(viewMax) : null}
                            minValue={viewMin != null ? msToDate(viewMin) : null}
                            maxValue={msToDate(dataMax)}
                            onChange={(value) => {
                                if (!value) return;
                                setCustomTo(dateToMs(value));
                                setCustomFrom((prev) => prev ?? viewMin ?? dataMin);
                                setPreset('custom');
                            }}
                        />
                    </div>
                </div>
            )}

            <HighchartsReact highcharts={Highcharts} options={options} />
        </section>
    );
}
