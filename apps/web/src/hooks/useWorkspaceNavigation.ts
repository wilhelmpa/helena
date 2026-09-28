import { useCallback, useEffect, useState } from 'react';
import { dashboardsPath } from '@/utils/paths';

export function useWorkspaceNavigation(_projectKey: string | null, defaultSidebarOpen: boolean) {
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  useEffect(() => {
    const saved = document.cookie.split('; ').find((entry) => entry.startsWith('sidebar_state='));
    if (saved) setSidebarOpen(saved.split('=')[1] === 'true');
  }, []);
  const projectDestination = useCallback((key: string) => dashboardsPath(key), []);
  return { sidebarOpen, setSidebarOpen, projectDestination };
}
