import { useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const APP_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];

/**
 * Line chart of percent-complete over time: one line per app (baseline
 * Angular/Knockout removed, measured at each PR) plus a bold overall line.
 */
export default function ProgressChart({ appList, totalSeries }) {
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
    }, [appList, totalSeries]);

    return (
        <section>
            <h2>Migration progress over time</h2>
            <p className="subtitle">
                Percent of each app’s baseline Angular / Knockout code removed, measured at
                every pull request from the baseline commit to now.
            </p>
            <HighchartsReact highcharts={Highcharts} options={options} />
        </section>
    );
}
