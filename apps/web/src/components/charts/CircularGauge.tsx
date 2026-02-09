'use client';

import { cn } from '@/lib/utils';

interface CircularGaugeProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  sublabel?: string;
  showPercentage?: boolean;
}

const sizeConfig = {
  sm: { width: 80, strokeWidth: 6, fontSize: 'text-lg', labelSize: 'text-xs' },
  md: { width: 100, strokeWidth: 8, fontSize: 'text-xl', labelSize: 'text-xs' },
  lg: { width: 120, strokeWidth: 10, fontSize: 'text-2xl', labelSize: 'text-sm' },
};

function getColor(percentage: number): string {
  if (percentage >= 90) return '#ef4444'; // red
  if (percentage >= 70) return '#f59e0b'; // amber
  return '#22c55e'; // green
}

export function CircularGauge({
  value,
  max = 100,
  size = 'md',
  label,
  sublabel,
  showPercentage = true,
}: CircularGaugeProps) {
  const config = sizeConfig[size];
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const color = getColor(percentage);

  const radius = (config.width - config.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: config.width, height: config.width }}>
        <svg width={config.width} height={config.width} className="transform -rotate-90">
          {/* Background circle */}
          <circle
            cx={config.width / 2}
            cy={config.width / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={config.strokeWidth}
          />
          {/* Progress circle */}
          <circle
            cx={config.width / 2}
            cy={config.width / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={config.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('font-semibold text-text-primary', config.fontSize)}>
            {showPercentage ? `${percentage.toFixed(0)}%` : value}
          </span>
        </div>
      </div>
      {(label || sublabel) && (
        <div className="mt-2 text-center">
          {label && (
            <p className={cn('font-medium text-text-primary', config.labelSize)}>{label}</p>
          )}
          {sublabel && <p className="text-xs text-text-muted">{sublabel}</p>}
        </div>
      )}
    </div>
  );
}
