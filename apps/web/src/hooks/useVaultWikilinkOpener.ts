import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { resolveWikilink, vaultFileUrl } from '@/lib/api/endpoints/knowledge';
import { vaultNotePath } from '@/utils/paths';
import { parseWikilink, wikilinkTask } from '@/utils/wikilink';

export function useVaultWikilinkOpener(
  notePath: string,
  options: { onMissing?: (target: string) => void; beforeNavigate?: () => boolean } = {},
) {
  const router = useRouter();
  const t = useTranslations('documents');
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [notePath],
  );

  return useCallback(
    async (inner: string) => {
      const attempt = ++request.current;
      const task = wikilinkTask(inner);
      if (task) {
        if (optionsRef.current.beforeNavigate?.() !== false) router.push(`/${task}`);
        return;
      }
      const { target } = parseWikilink(inner);
      if (!target) return;
      let path: string | null;
      try {
        ({ path } = await resolveWikilink(notePath, target));
      } catch {
        if (attempt === request.current) toast.error(t('linkFailed'));
        return;
      }
      if (attempt !== request.current) return;
      if (!path) {
        if (optionsRef.current.onMissing) optionsRef.current.onMissing(target);
        else toast(t('linkNotFound', { name: target }));
        return;
      }
      if (optionsRef.current.beforeNavigate?.() === false) return;
      if (/\.md$/i.test(path)) router.push(vaultNotePath(path));
      else window.open(vaultFileUrl(path), '_blank', 'noopener');
    },
    [notePath, router, t],
  );
}
