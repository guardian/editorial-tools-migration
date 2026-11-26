import Highcharts from 'highcharts';

function withOpacity(color: string, opacity: number): string {
    const result = Highcharts.color(color).setOpacity(opacity).get('rgba');
    if (typeof result !== 'string') throw new Error(`Invalid chart color: ${color}`);
    return result;
}

export function areaFill(color: string): Highcharts.GradientColorObject {
    return {
        linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
        stops: [
            [0, withOpacity(color, 0.2)],
            [1, withOpacity(color, 0)],
        ],
    };
}
