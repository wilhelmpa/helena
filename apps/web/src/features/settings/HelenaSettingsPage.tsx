'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import { useHydrated } from '@/hooks/useHydrated';
import { useTeamsQuery } from '@/services/teams.service';
import Shell from '@/components/layout/Shell';
import SectionPageView from '@/components/common/page/SectionPageView';
import { EmptyState, PageChromeCtx } from '@/design-system';
import SettingsAreaContent from './SettingsAreaContent';
import {
  HELENA_SETTINGS,
  helenaSettingsPath,
  resolveSettingsLocation,
  withSettingsParam,
} from './settingsModalCatalog';

// One page of Helena's settings (docs/einstellungen-struktur.md, „Endgültig“): the
// settings for all projects and the system, a sidebar entry of Helena like a project's
// settings are of the project. Each page shows the same sections the old Administrator
// pages did, so nothing is lost; `?tab=` picks a tab of a page (Server → Backup) or a team.
// Only the owner (the Administrator, who owns Helena) sees them; the API checks the same.
export default function HelenaSettingsPage({ section }: { section: string }) {
  const t = useTranslations('settings.modal');
  const tNav = useTranslations('nav');
  const params = useSearchParams();
  const { data: session, isPending } = useSession();
  // The session can be in the store on hydration while the server rendered without it.
  const mounted = useHydrated();
  const admin = mounted && session?.user.role === 'god';
  const teamId = useTeamsQuery().data?.[0]?.id ?? null;
  const def = HELENA_SETTINGS.find((item) => item.slug === section);
  const title = def ? t(`sections.${def.slug}.label` as never) : tNav('settings');
  const extra = params.get('tab') ?? undefined;
  // A page that moved when the settings were merged (Benutzer → Organisation, E-Mail-Versand
  // → Benachrichtigungen & Kanäle, Tastenkürzel → Mein Konto): its old address leads there.
  const router = useRouter();
  const moved = resolveSettingsLocation({ area: 'admin', slug: section, extra });
  const movedTo =
    moved.slug === section && moved.area === 'admin'
      ? null
      : moved.area === 'admin'
        ? helenaSettingsPath(moved.slug, moved.extra)
        : withSettingsParam('/', moved);
  useEffect(() => {
    if (movedTo) router.replace(movedTo);
  }, [movedTo, router]);

  return (
    <Shell globalHome globalTitle={title} autoOpenGlobalChat={false}>
      <SectionPageView title={title}>
        {!mounted || isPending ? null : !admin ? (
          <EmptyState>{tNav('adminOnly')}</EmptyState>
        ) : !def ? (
          <EmptyState>{t('noResults')}</EmptyState>
        ) : (
          <div className="helena-settings-page" data-settings-section={def.slug}>
            {/* The sections were pages of their own: here the page's header names them, so
                their own title rows step back as they did in the modal. */}
            <PageChromeCtx.Provider value="modal">
              <div className="settings-modal-existing">
                <SettingsAreaContent
                  location={{ area: 'admin', slug: def.slug, ...(extra ? { extra } : {}) }}
                  teamId={teamId}
                />
              </div>
            </PageChromeCtx.Provider>
          </div>
        )}
      </SectionPageView>
    </Shell>
  );
}
