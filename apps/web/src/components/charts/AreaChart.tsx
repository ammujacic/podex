'use client';

import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, parseISO } from 'date-fns';

interface DataPoint {
  date: string;
  value: number;
}

interface AreaChartProps {
  data: DataPoint[];
  color?: string;
  height?: number;
  formatValue?: (value: number) => string;
  title?: string;
  subtitle?: string;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toFixed(0);
}

interface TooltipPayload {
  value: number;
  payload: DataPoint;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  formatValue?: (value: number) => string;
}

function CustomTooltip({ active, payload, formatValue }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0];
  if (!data) return null;

  const date = parseISO(data.payload.date);
  const formattedDate = format(date, 'MMM d, yyyy');
  const formattedValue = formatValue ? formatValue(data.value) : formatNumber(data.value);

  return (
    <div className="bg-elevated border border-border-subtle rounded-lg px-3 py-2 shadow-lg">
      <p className="text-text-muted text-xs">{formattedDate}</p>
      <p className="text-text-primary font-semibold">{formattedValue}</p>
    </div>
  );
}

export function AreaChart({
  data,
  color = '#8B5CF6',
  height = 200,
  formatValue,
  title,
  subtitle,
}: AreaChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-surface rounded-xl p-6 border border-border-subtle">
        {title && <h3 className="text-sm font-medium text-text-primary mb-1">{title}</h3>}
        <div className="flex items-center justify-center text-text-muted" style={{ height }}>
          No data available
        </div>
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const avg = total / data.length;

  return (
    <div className="bg-surface rounded-xl p-6 border border-border-subtle">
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-medium text-text-primary">{title}</h3>}
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>
      )}

      <div className="flex items-baseline gap-4 mb-4">
        <div>
          <p className="text-2xl font-semibold text-text-primary">
            {formatValue ? formatValue(total) : formatNumber(total)}
          </p>
          <p className="text-xs text-text-muted">Total</p>
        </div>
        <div>
          <p className="text-lg font-medium text-text-secondary">
            {formatValue ? formatValue(avg) : formatNumber(avg)}
          </p>
          <p className="text-xs text-text-muted">Daily avg</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <RechartsAreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
          <defs>
            <linearGradient id={`gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => format(parseISO(value), 'MMM d')}
            interval="preserveStartEnd"
            minTickGap={50}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatNumber}
            width={45}
          />
          <Tooltip content={<CustomTooltip formatValue={formatValue} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#gradient-${color.replace('#', '')})`}
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
