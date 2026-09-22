import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { matchingProjectDestination, safeProjectDestination } from '@/utils/workspaceNavigation';

export function useWorkspaceNavigation(projectKey: string | null, defaultSidebarOpen: boolean) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  useEffect(() => {
    const saved = document.cookie.split('; ').find((entry) => entry.startsWith('sidebar_state='));
    if (saved) setSidebarOpen(saved.split('=')[1] === 'true');
  }, []);
  useEffect(() => {
    if (!projectKey) return;
    try {
      localStorage.setItem(
        `workspace:project:${projectKey}:route`,
        safeProjectDestination(projectKey, pathname),
      );
    } catch {
      /* Navigation still works without storage. */
    }
  }, [pathname, projectKey]);
  const projectDestination = useCallback(
    (key: string) => {
      const matching = matchingProjectDestination(projectKey, key, pathname);
      if (matching) return matching;
      try {
        return safeProjectDestination(key, localStorage.getItem(`workspace:project:${key}:route`));
      } catch {
        return safeProjectDestination(key, null);
      }
    },
    [pathname, projectKey],
  );
  return { sidebarOpen, setSidebarOpen, projectDestination };
}
