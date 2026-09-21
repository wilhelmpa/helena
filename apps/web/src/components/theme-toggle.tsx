'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { syncWorkspaceTheme } from '@/lib/api/endpoints/connections';
import { useUpdateAccountPreferences } from '@/services/preferences.service';
import { notifyWorkspaceThemeSynced } from '@/utils/workspaceTheme';

// Toggles between the light and dark theme. The choice is saved to the account, the
// same as picking it in preferences, so it survives a new session and reaches other
// devices; PreferencesSync hands the stored value back to next-themes on load. The
// icon is rendered only after mount so the server and client markup match (the
// resolved theme is unknown during SSR).
export function ThemeToggle() {
  const t = useTranslations('common');
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const update = useUpdateAccountPreferences();
  const sync = useMutation({
    mutationFn: syncWorkspaceTheme,
    onSuccess: (result) => {
      const updated = result.results
        .filter((item) => item.status === 'updated')
        .map((item) => item.service);
      notifyWorkspaceThemeSynced(result.theme, updated);
      const failures = result.results.length - updated.length;
      if (failures > 0) toast.warning(t('themeSyncPartial', { count: failures }));
    },
  });
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          aria-label={t('toggleTheme')}
          disabled={update.isPending || sync.isPending}
          onClick={() => {
            const next = isDark ? 'light' : 'dark';
            setTheme(next);
            update.mutate({ theme: next });
            sync.mutate(next);
          }}
        >
          {mounted && (isDark ? <Sun /> : <Moon />)}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('toggleTheme')}</TooltipContent>
    </Tooltip>
  );
}
