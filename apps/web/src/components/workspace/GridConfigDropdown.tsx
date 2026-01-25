'use client';

import { useState, useRef, useEffect } from 'react';
import { Settings, RotateCcw } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

export function GridConfigDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { gridConfig, setGridConfig, resetGridConfig } = useUIStore();

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleColumnsChange = (columns: number) => {
    setGridConfig({ columns });
  };

  const handleRowHeightChange = (rowHeight: number) => {
    setGridConfig({ rowHeight });
  };

  const handleMaxRowsChange = (maxRows: number) => {
    setGridConfig({ maxRows });
  };

  const handleMaxColsChange = (maxCols: number) => {
    setGridConfig({ maxCols });
  };

  const handleReset = () => {
    resetGridConfig();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Configure grid layout"
        aria-expanded={isOpen}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
          isOpen
            ? 'bg-overlay text-text-primary'
            : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
        )}
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border-default bg-elevated p-4 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-text-primary">Grid Configuration</h3>
            <button
              onClick={handleReset}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-overlay hover:text-text-primary"
              aria-label="Reset to defaults"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>

          <div className="space-y-4">
            {/* Grid Columns */}
            <div>
              <label className="mb-2 block text-xs font-medium text-text-secondary">
                Grid Columns
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <button
                    key={num}
                    onClick={() => handleColumnsChange(num)}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded border text-xs font-medium transition-colors',
                      gridConfig.columns === num
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-border-default text-text-secondary hover:border-border-hover hover:text-text-primary'
                    )}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Row Height */}
            <div>
              <label className="mb-2 block text-xs font-medium text-text-secondary">
                Row Height (px)
              </label>
              <div className="flex gap-2">
                {[200, 250, 300, 350, 400, 450].map((height) => (
                  <button
                    key={height}
                    onClick={() => handleRowHeightChange(height)}
                    className={cn(
                      'flex h-8 flex-1 items-center justify-center rounded border text-xs font-medium transition-colors',
                      gridConfig.rowHeight === height
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-border-default text-text-secondary hover:border-border-hover hover:text-text-primary'
                    )}
                  >
                    {height}
                  </button>
                ))}
              </div>
            </div>

            {/* Max Rows Per Card */}
            <div>
              <label className="mb-2 block text-xs font-medium text-text-secondary">
                Max Rows Per Card
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleMaxRowsChange(0)}
                  className={cn(
                    'flex h-8 flex-1 items-center justify-center rounded border text-xs font-medium transition-colors',
                    gridConfig.maxRows === 0
                      ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                      : 'border-border-default text-text-secondary hover:border-border-hover hover:text-text-primary'
                  )}
                >
                  Unlimited
                </button>
                {[1, 2, 3, 4].map((num) => (
                  <button
                    key={num}
                    onClick={() => handleMaxRowsChange(num)}
                    className={cn(
                      'flex h-8 w-10 items-center justify-center rounded border text-xs font-medium transition-colors',
                      gridConfig.maxRows === num
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-border-default text-text-secondary hover:border-border-hover hover:text-text-primary'
                    )}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Max Columns Per Card */}
            <div>
              <label className="mb-2 block text-xs font-medium text-text-secondary">
                Max Columns Per Card
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleMaxColsChange(0)}
                  className={cn(
                    'flex h-8 flex-1 items-center justify-center rounded border text-xs font-medium transition-colors',
                    gridConfig.maxCols === 0
                      ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                      : 'border-border-default text-text-secondary hover:border-border-hover hover:text-text-primary'
                  )}
                >
                  Match Grid
                </button>
                {[1, 2, 3, 4].map((num) => (
                  <button
                    key={num}
                    onClick={() => handleMaxColsChange(num)}
                    className={cn(
                      'flex h-8 w-10 items-center justify-center rounded border text-xs font-medium transition-colors',
                      gridConfig.maxCols === num
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-border-default text-text-secondary hover:border-border-hover hover:text-text-primary'
                    )}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-border-default pt-3 text-xs text-text-tertiary">
              <p>
                <strong>Grid Columns:</strong> Number of columns in the grid layout
              </p>
              <p className="mt-1">
                <strong>Row Height:</strong> Height of each row in pixels
              </p>
              <p className="mt-1">
                <strong>Max Rows/Cols:</strong> Maximum size for individual cards (0 = unlimited or
                match grid)
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
