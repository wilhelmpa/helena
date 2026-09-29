'use client';

import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';

// A line over time with a soft area under it (docs/design-system.md §4): one series, values
// on the right, time along the bottom, a tooltip with the time and the value. For the
// equity curve of the trading dashboard and every figure that changes over time. `x` is a
// time in ms; the caller words both axes and the tooltip (`formatX`, `formatY`), so the
// chart carries no locale of its own. `tone` picks the line: accent (neutral), success
// (up) or danger (down).
export type TimeSeriesPoint = { x: number; y: number };
export type TimeSeriesTone = 'accent' | 'success' | 'danger';

const COLOR: Record<TimeSeriesTone, string> = {
  accent: 'var(--accent)',
  success: 'var(--status-done)',
  danger: 'var(--danger)',
};

export function TimeSeriesChart({
  points,
  label,
  tone = 'accent',
  formatX,
  formatY,
  formatTip,
}: {
  points: TimeSeriesPoint[];
  // What the chart shows, for screen readers.
  label: string;
  tone?: TimeSeriesTone;
  // A tick on the time axis.
  formatX: (x: number) => string;
  // A tick on the value axis and the value in the tooltip.
  formatY: (y: number) => string;
  // The time in the tooltip (defaults to the tick).
  formatTip?: (x: number) => string;
}) {
  const gradient = `ds-timeseries-${useId().replace(/:/g, '')}`;
  const config: ChartConfig = { value: { label, color: COLOR[tone] } };
  return (
    <ChartContainer
      dir="ltr"
      config={config}
      className="ds-timeseries"
      role="img"
      aria-label={label}
    >
      <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="x"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          tickFormatter={formatX}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
          fontSize={11}
        />
        <YAxis
          orientation="right"
          type="number"
          domain={['auto', 'auto']}
          tickFormatter={formatY}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={72}
          fontSize={11}
        />
        <Tooltip
          cursor={{ stroke: 'var(--line-strong)' }}
          content={({ active, payload }) => {
            const point = active
              ? (payload?.[0]?.payload as TimeSeriesPoint | undefined)
              : undefined;
            if (!point) return null;
            return (
              <div className="ds-timeseries-tip">
                <span>{(formatTip ?? formatX)(point.x)}</span>
                <strong>{formatY(point.y)}</strong>
              </div>
            );
          }}
        />
        <Area
          dataKey="y"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2}
          fill={`url(#${gradient})`}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
