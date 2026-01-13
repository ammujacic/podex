import { ChevronDown } from 'lucide-react';

export interface TimeRangeOption {
  label: string;
  value: string;
  days: number;
}

interface TimeRangeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  options?: TimeRangeOption[];
  className?: string;
}

const DEFAULT_OPTIONS: TimeRangeOption[] = [
  { label: 'Last 24 Hours', value: '1d', days: 1 },
  { label: 'Last 7 Days', value: '7d', days: 7 },
  { label: 'Last 30 Days', value: '30d', days: 30 },
  { label: 'Last Year', value: '1y', days: 365 },
  { label: 'All Time', value: 'all', days: 9999 },
];

export function TimeRangeSelector({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  className = '',
}: TimeRangeSelectorProps) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-surface border border-border-default rounded-lg px-3 py-2 pr-8 text-sm text-text-primary hover:border-border-hover focus:outline-none focus:border-accent-primary transition-colors cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
    </div>
  );
}

// Helper function to get days from value
export function getDaysFromValue(
  value: string,
  options: TimeRangeOption[] = DEFAULT_OPTIONS
): number {
  const option = options.find((opt) => opt.value === value);
  return option?.days || 30;
}

// Helper function to get label from value
export function getLabelFromValue(
  value: string,
  options: TimeRangeOption[] = DEFAULT_OPTIONS
): string {
  const option = options.find((opt) => opt.value === value);
  return option?.label || 'Last 30 Days';
}
