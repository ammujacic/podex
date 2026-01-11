'use client';

import { useMemo } from 'react';

interface UsageDataPoint {
  label: string;
  value: number;
  color: string;
}

interface UsageChartProps {
  data: UsageDataPoint[];
  total?: number;
  title?: string;
  height?: number;
}

export function UsageChart({ data, total, title, height: _height = 200 }: UsageChartProps) {
  const maxValue = useMemo(() => {
    if (total) return total;
    return Math.max(...data.map((d) => d.value), 1);
  }, [data, total]);

  const percentage = useMemo(() => {
    const sum = data.reduce((acc, d) => acc + d.value, 0);
    return Math.min((sum / maxValue) * 100, 100);
  }, [data, maxValue]);

  return (
    <div className="space-y-3">
      {title && <h4 className="text-sm font-medium text-neutral-300">{title}</h4>}

      {/* Bar chart */}
      <div className="space-y-2">
        {data.map((item, index) => {
          const itemPercentage = (item.value / maxValue) * 100;
          return (
            <div key={index} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-400">{item.label}</span>
                <span className="text-neutral-300">{item.value.toLocaleString()}</span>
              </div>
              <div className="h-2 bg-neutral-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(itemPercentage, 100)}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Total progress */}
      {total && (
        <div className="pt-2 border-t border-neutral-700">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-neutral-400">Total Usage</span>
            <span className="text-neutral-300">
              {data.reduce((acc, d) => acc + d.value, 0).toLocaleString()} /{' '}
              {total.toLocaleString()}
            </span>
          </div>
          <div className="h-3 bg-neutral-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                percentage >= 90
                  ? 'bg-red-500'
                  : percentage >= 75
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 mt-1">{percentage.toFixed(1)}% used</p>
        </div>
      )}
    </div>
  );
}

interface DonutChartProps {
  data: UsageDataPoint[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string;
}

export function DonutChart({
  data,
  size = 160,
  strokeWidth = 24,
  centerLabel,
  centerValue,
}: DonutChartProps) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPercentage = 0;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(64, 64, 64)"
          strokeWidth={strokeWidth}
        />
        {/* Data segments */}
        {data.map((item, index) => {
          const percentage = (item.value / total) * 100;
          const strokeDasharray = `${(percentage / 100) * circumference} ${circumference}`;
          const strokeDashoffset = -((accumulatedPercentage / 100) * circumference);
          accumulatedPercentage += percentage;

          return (
            <circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={item.color}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          );
        })}
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {centerValue && <span className="text-2xl font-bold text-white">{centerValue}</span>}
        {centerLabel && <span className="text-xs text-neutral-400">{centerLabel}</span>}
      </div>
    </div>
  );
}
