import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { browserLockRelease, browserLockTakeover } from '@/utils/browserControl';

// Übernehmen / Zurückgeben (design §5: "Der Knopf 'Übernehmen' setzt owner... 'Zurückgeben'
// gibt frei."): the owner's side of the project browser's control lock. Used by both the
// live view's banner (WorkspaceBrowserLive.tsx, including the CAPTCHA handover card) and
// the toolbar's own quick-access button (WorkspaceBrowserBar.tsx) — each calls this
// independently with the same `base`, matching how useBrowserControl already works.
export function useBrowserLock(base: string) {
  const t = useTranslations('nav.workspace.browserBar');
  const takeOverMutation = useMutation({
    mutationFn: () => browserLockTakeover(base),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('takeOverError'));
    },
  });
  const releaseMutation = useMutation({
    mutationFn: () => browserLockRelease(base),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('handBackError'));
    },
  });
  return {
    takeOver: takeOverMutation.mutate,
    takingOver: takeOverMutation.isPending,
    release: releaseMutation.mutate,
    releasing: releaseMutation.isPending,
  };
}
