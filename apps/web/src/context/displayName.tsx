'use client';

import { createContext, useContext, type ReactNode } from 'react';

const DisplayNameContext = createContext('Helena');

export function DisplayNameProvider({ name, children }: { name: string; children: ReactNode }) {
  return <DisplayNameContext.Provider value={name}>{children}</DisplayNameContext.Provider>;
}

export function useDisplayName(): string {
  return useContext(DisplayNameContext);
}
