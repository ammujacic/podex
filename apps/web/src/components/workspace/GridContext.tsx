'use client';

import { createContext, useContext, type RefObject } from 'react';

interface GridContextValue {
  gridRef: RefObject<HTMLDivElement | null>;
}

const GridContext = createContext<GridContextValue | null>(null);

export function GridProvider({
  children,
  gridRef,
}: {
  children: React.ReactNode;
  gridRef: RefObject<HTMLDivElement | null>;
}) {
  return <GridContext.Provider value={{ gridRef }}>{children}</GridContext.Provider>;
}

export function useGridContext() {
  const context = useContext(GridContext);
  if (!context) {
    throw new Error('useGridContext must be used within a GridProvider');
  }
  return context;
}

export function useOptionalGridContext() {
  return useContext(GridContext);
}
