'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { browserTabsQueryKey, BrowserControlError } from '@/utils/browserControl';
import { installWebLinkNavigation, webLinkKind, type OpenWebLink } from '@/utils/webLinkNavigation';
import { openProjectWebLink, WebLinkOpenError } from '@/utils/openProjectWebLink';
import { projectPath } from '@/utils/paths';

export function useWebLinkNavigation(projectKey: string | null, showTool: (tool: string) => void) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('browserGateway');
  const currentProject = useRef(projectKey);
  useLayoutEffect(() => {
    currentProject.current = projectKey;
  }, [projectKey]);
  const open: OpenWebLink = useCallback(
    (url, scope) => {
      if (webLinkKind(url, window.location.href) !== 'web') return;
      void (async () => {
        const { base, source } = await openProjectWebLink(url, scope);
        void queryClient.invalidateQueries({ queryKey: browserTabsQueryKey(base) });
        if (currentProject.current === source) showTool('browser');
        else router.push(`${source === null ? '/' : projectPath(source)}?tool=browser`);
      })().catch((error: unknown) => {
        // Do not reflect response bodies or URLs (which may contain credentials) in a toast.
        if (error instanceof WebLinkOpenError && error.reason !== 'unsafe') {
          toast.error(t(error.reason));
          return;
        }
        const code = error instanceof BrowserControlError ? error.code : 'failed';
        toast.error(t(`errors.${code}`));
      });
    },
    [queryClient, router, showTool, t],
  );

  useEffect(
    () => installWebLinkNavigation(document, open, () => projectKey, window.location.href),
    [open, projectKey],
  );
  return { open, scope: projectKey };
}
