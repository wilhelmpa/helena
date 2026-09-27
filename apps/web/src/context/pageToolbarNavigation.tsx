'use client';

import { createContext, useContext, type ReactNode } from 'react';

const PageToolbarNavigationContext = createContext<ReactNode>(null);

// A composed page keeps its navigation at the start of the active view's toolbar.
// The route may supply the view as a server-composed child without render callbacks.
export function PageToolbarNavigationProvider({
  navigation,
  children,
}: {
  navigation: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageToolbarNavigationContext.Provider value={navigation}>
      {children}
    </PageToolbarNavigationContext.Provider>
  );
}

export function usePageToolbarNavigation() {
  return useContext(PageToolbarNavigationContext);
}
