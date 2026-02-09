import { ChevronDown } from 'lucide-react';
import { useConfigStore } from '@/stores/config';

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

// Helper function to get options from ConfigStore (config is guaranteed to be loaded by ConfigGate)
function getDefaultOptions(): TimeRangeOption[] {
  const config = useConfigStore.getState().getTimeRangeOptions();
  if (!config) {
    throw new Error('ConfigStore not initialized - time_range_options not available');
  }
  return config;
}

export function TimeRangeSelector({
  value,
  onChange,
  options,
  className = '',
}: TimeRangeSelectorProps) {
  // Get options from ConfigStore if not provided (config is guaranteed to be loaded by ConfigGate)
  const configOptions = useConfigStore((s) => s.getTimeRangeOptions());
  const effectiveOptions = options ?? configOptions!;
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-surface border border-border-default rounded-lg px-3 py-2 pr-8 text-sm text-text-primary hover:border-border-hover focus:outline-none focus:border-accent-primary transition-colors cursor-pointer"
      >
        {effectiveOptions.map((opt) => (
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
export function getDaysFromValue(value: string, options?: TimeRangeOption[]): number {
  const effectiveOptions = options ?? getDefaultOptions();
  const option = effectiveOptions.find((opt) => opt.value === value);
  return option?.days || 30;
}

// Helper function to get label from value
export function getLabelFromValue(value: string, options?: TimeRangeOption[]): string {
  const effectiveOptions = options ?? getDefaultOptions();
  const option = effectiveOptions.find((opt) => opt.value === value);
  return option?.label || 'Last 30 Days';
}
