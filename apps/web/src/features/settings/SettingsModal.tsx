'use client';

import { useCallback, useEffect, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTeamsQuery } from '@/services/teams.service';
import { useSession } from '@/lib/auth-client';
import { ShellHeaderActionsSlotCtx, ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import { Modal, ModalNavItem } from '@/design-system';
import SettingsAreaContent from './SettingsAreaContent';
import {
  DEFAULT_SECTION,
  HELENA_SETTINGS,
  SETTINGS_MODAL_OPEN,
  SETTINGS_PARAM,
  helenaSettingsPath,
  parseSettingsParam,
  resolveSettingsLocation,
  settingsModalRoute,
  settingsModalSections,
  withSettingsParam,
  type OpenSettingsRequest,
  type SettingsLocation,
} from './settingsModalCatalog';

const returnKey = 'helena:settings-return';

// Whether the modal put its own entry on the history stack, so closing takes it off
// again (Back then leaves the page instead of reopening the modal).
let pushedEntry = false;

function currentHref() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function pageOf(raw: SettingsLocation) {
  const location = resolveSettingsLocation(raw);
  const known = HELENA_SETTINGS.some((item) => item.slug === location.slug);
  return helenaSettingsPath(known ? location.slug : DEFAULT_SECTION.admin, location.extra);
}

// Mein Konto (docs/einstellungen-struktur.md, „Endgültig“): the only settings that still
// open as a modal — small, over the page the user is on, from the avatar and name at the
// bottom left. Where it stands lives in the URL (`?settings=account.<slug>`), set with the
// browser's own history, so the page behind never navigates or reloads.
//
// It also sends the old places of the other settings to their pages: `?settings=admin.x`
// (and the tabs that were merged into it) and the old addresses (/god/…, /access,
// /account/teams/…) go to Helena's settings (/settings/<slug>), `?settings=project.x` to
// the project's settings page, and the old account pages open Mein Konto over the page
// the user came from.
export default function SettingsModal() {
  const t = useTranslations('settings.modal');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const legacy = settingsModalRoute(pathname);
  const param = parseSettingsParam(searchParams.get(SETTINGS_PARAM));
  const location = legacy ? null : param?.area === 'account' ? param : null;
  const teamId = useTeamsQuery().data?.[0]?.id ?? null;
  const { data: session } = useSession();
  const sections = settingsModalSections(session?.user.role === 'god').account;

  // Moves the modal to `next` (null closes it) without touching the page behind.
  const go = useCallback((next: SettingsLocation | null) => {
    const href = withSettingsParam(currentHref(), next);
    if (!next && pushedEntry) {
      pushedEntry = false;
      window.history.back();
      return;
    }
    if (
      next &&
      !parseSettingsParam(new URLSearchParams(window.location.search).get(SETTINGS_PARAM))
    ) {
      pushedEntry = true;
      window.history.pushState(null, '', href);
      return;
    }
    window.history.replaceState(null, '', href);
  }, []);

  // Remember the last page that is not an old settings URL: that page stays behind Mein
  // Konto when an old account URL is opened.
  const queryString = searchParams.toString();
  useEffect(() => {
    if (legacy) return;
    sessionStorage.setItem(
      returnKey,
      withSettingsParam(`${pathname}${queryString ? `?${queryString}` : ''}`, null),
    );
  }, [legacy, pathname, queryString]);

  // An old settings address.
  useEffect(() => {
    if (!legacy) return;
    if (legacy.area === 'admin') {
      router.replace(pageOf(legacy));
      return;
    }
    let back = sessionStorage.getItem(returnKey);
    if (!back || settingsModalRoute(back.split(/[?#]/)[0] ?? '')) back = '/';
    router.replace(withSettingsParam(back, legacy), { scroll: false });
  }, [legacy, router]);

  // `?settings=admin.<slug>` (and home/helena): the page of Helena's settings.
  const legacyAdmin = !legacy && param?.area === 'admin' ? param : null;
  useEffect(() => {
    if (legacyAdmin) router.replace(pageOf(legacyAdmin));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on its text
  }, [legacyAdmin?.slug, legacyAdmin?.extra, router]);

  // `?settings=project.<slug>` from before project settings became pages: the page.
  const legacyProject = searchParams.get(SETTINGS_PARAM)?.startsWith('project.');
  useEffect(() => {
    if (!legacyProject) return;
    const key = pathname.match(/^\/project\/([^/]+)/)?.[1];
    const slug = searchParams.get(SETTINGS_PARAM)!.split('.')[1] ?? 'general';
    const special = ['members', 'notifications', 'mcp'].includes(slug);
    if (key) router.replace(`/project/${key}/${special ? slug : `settings/${slug}`}`);
  }, [legacyProject, pathname, router, searchParams]);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<OpenSettingsRequest | undefined>).detail ?? {};
      if (detail.scope && detail.scope !== 'account') {
        const extra = detail.teamId != null ? String(detail.teamId) : detail.tab;
        const target = resolveSettingsLocation({
          area: 'admin',
          slug: detail.section ?? DEFAULT_SECTION.admin,
          extra,
        });
        if (target.area === 'admin') {
          router.push(pageOf(target));
          return;
        }
        go(target);
        return;
      }
      const known = sections.some((item) => item.slug === detail.section);
      go({ area: 'account', slug: known ? detail.section! : DEFAULT_SECTION.account });
    }
    window.addEventListener(SETTINGS_MODAL_OPEN, handleOpen);
    return () => window.removeEventListener(SETTINGS_MODAL_OPEN, handleOpen);
  }, [go, router, sections]);

  const close = useCallback(() => go(null), [go]);

  // A link inside Mein Konto to another account section moves the modal; a link to one of
  // Helena's settings closes it and opens that page.
  function keepLinksInModal(event: MouseEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as Element).closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor || (anchor.target && anchor.target !== '_self')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const target = settingsModalRoute(url.pathname);
    if (!target) return;
    event.preventDefault();
    if (target.area === 'account') {
      go(target);
      return;
    }
    go(null);
    window.setTimeout(() => router.push(pageOf(target)), 0);
  }

  if (!location) return null;
  const activeSlug = location.slug;
  const label = (slug: string) => t(`sections.${slug}.label` as never);
  const description = (slug: string) => t(`sections.${slug}.hint` as never);

  return (
    <Modal
      open
      size="small"
      label={t('tabs.account')}
      onClose={close}
      testId="settings-modal"
      title={t('tabs.account')}
      nav={sections.map((item) => (
        <ModalNavItem
          key={item.slug}
          active={item.slug === activeSlug}
          onClick={() => go({ area: 'account', slug: item.slug })}
        >
          {label(item.slug)}
        </ModalNavItem>
      ))}
    >
      <div
        onClickCapture={keepLinksInModal}
        data-settings-area="account"
        data-settings-section={activeSlug}
      >
        <header className="ds-modal-pane-head">
          <h2>{label(activeSlug)}</h2>
          {description(activeSlug) && <p>{description(activeSlug)}</p>}
        </header>
        <div className="ds-modal-pane-body settings-modal-existing">
          <ShellHeaderSlotCtx.Provider value={null}>
            <ShellHeaderActionsSlotCtx.Provider value={null}>
              <SettingsAreaContent location={location} teamId={teamId} />
            </ShellHeaderActionsSlotCtx.Provider>
          </ShellHeaderSlotCtx.Provider>
        </div>
      </div>
    </Modal>
  );
}
