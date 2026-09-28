'use client';

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { projectSettingsPages } from './projectSettingsPages';
import { useTeamsQuery } from '@/services/teams.service';
import { ShellHeaderActionsSlotCtx, ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import { Modal, ModalNavGroup, ModalNavItem, type ModalTab } from '@/design-system';
import SettingsAreaContent from './SettingsAreaContent';
import {
  DEFAULT_SECTION,
  SETTINGS_MODAL_OPEN,
  SETTINGS_PARAM,
  parseSettingsParam,
  settingsModalRoute,
  settingsModalSections,
  withSettingsParam,
  type ModalSectionDef,
  type OpenSettingsRequest,
  type SettingsArea,
  type SettingsLocation,
} from './settingsModalCatalog';

const returnKey = 'helena:settings-return';

// Whether the modal put its own entry on the history stack, so closing takes it off
// again (Back then leaves the page instead of reopening the modal).
let pushedEntry = false;

function currentHref() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

// The global settings (docs/design-system.md §3, §7): one large modal over the page the
// user is on, with the tabs Mein Konto, Helena and Administrator and a search over every
// setting. Where it stands lives in the URL (`?settings=area.slug`), set with the
// browser's own history, so the page behind never navigates, reloads or re-renders:
// closing it leaves everything as it was, filters included. Old settings URLs
// (/account/…, /god/…) open it over the page the user came from.
export default function SettingsModal({
  projectKey = null,
  projectName = null,
}: {
  // The project the page behind belongs to: the search also finds its settings pages.
  projectKey?: string | null;
  projectName?: string | null;
}) {
  const t = useTranslations('settings.modal');
  const tNav = useTranslations('nav');
  const sectionText = useSettingsSectionText();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const legacy = settingsModalRoute(pathname);
  const location = legacy ? null : parseSettingsParam(searchParams.get(SETTINGS_PARAM));
  const { data: session } = useSession();
  const teams = useTeamsQuery().data ?? [];
  const admin = session?.user.role === 'god';
  const teamId = teams[0]?.id ?? null;
  const sections = useMemo(() => settingsModalSections(admin), [admin]);
  const [search, setSearch] = useState('');

  const tabs = useMemo<SettingsArea[]>(() => (admin ? ['account', 'admin'] : ['account']), [admin]);
  const label = (def: ModalSectionDef) => t(`sections.${def.slug}.label` as never);
  const description = (def: ModalSectionDef) => t(`sections.${def.slug}.hint` as never);
  const groupLabel = (group: string) => t(`groups.${group}` as never);

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

  // Remember the last page that is not an old settings URL: that page stays behind the
  // modal when such a URL is opened.
  const queryString = searchParams.toString();
  useEffect(() => {
    if (legacy) return;
    sessionStorage.setItem(
      returnKey,
      withSettingsParam(`${pathname}${queryString ? `?${queryString}` : ''}`, null),
    );
  }, [legacy, pathname, queryString]);

  useEffect(() => {
    if (!legacy) return;
    let back = sessionStorage.getItem(returnKey);
    if (!back || settingsModalRoute(back.split(/[?#]/)[0] ?? '')) back = '/';
    router.replace(withSettingsParam(back, legacy), { scroll: false });
  }, [legacy, router]);

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
      let area: SettingsArea =
        detail.scope === 'home' || detail.scope === 'helena' || detail.scope === 'admin'
          ? 'admin'
          : 'account';
      if (!tabs.includes(area)) area = 'account';
      const known = sections[area].some((item) => item.slug === detail.section);
      const slug = known && detail.section ? detail.section : DEFAULT_SECTION[area];
      const extra = detail.teamId != null ? String(detail.teamId) : detail.tab;
      setSearch('');
      go({ area, slug, ...(extra ? { extra } : {}) });
    }
    window.addEventListener(SETTINGS_MODAL_OPEN, handleOpen);
    return () => window.removeEventListener(SETTINGS_MODAL_OPEN, handleOpen);
  }, [go, sections, tabs]);

  const close = useCallback(() => go(null), [go]);
  const activeArea = location && tabs.includes(location.area) ? location.area : null;
  const activeSlug = location?.slug ?? '';
  const activeDef = activeArea
    ? sections[activeArea].find((item) => item.slug === activeSlug)
    : undefined;

  // A link inside a section to another settings page (a server tab, "→ Zugänge") moves
  // the modal instead of navigating the page behind it.
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
    go(target);
  }

  if (!location || !activeArea) return null;

  const query = search.trim().toLocaleLowerCase();
  const results = query
    ? tabs.flatMap((area) =>
        sections[area]
          .filter((item) =>
            `${label(item)} ${description(item)} ${item.keywords ?? ''}`
              .toLocaleLowerCase()
              .includes(query),
          )
          .map((item) => ({ item, area })),
      )
    : [];

  // The project's own settings pages (docs/einstellungen-struktur.md: the search finds
  // every level); a click opens the page and closes the modal.
  const projectResults =
    query && projectKey
      ? projectSettingsPages(projectKey).filter((page) =>
          `${page.group ? tNav(page.group as never) : ''} ${page.labelKey ? tNav(page.labelKey as never) : sectionText(page.slug).label} ${page.keywords}`
            .toLocaleLowerCase()
            .includes(query),
        )
      : [];

  const areaTabs: ModalTab[] = tabs.map((area) => ({ id: area, label: t(`tabs.${area}`) }));
  const current = sections[activeArea];
  const groups = [...new Set(current.map((item) => item.group ?? ''))];

  return (
    <Modal
      open
      label={t('title')}
      onClose={close}
      tabs={areaTabs}
      activeTab={activeArea}
      onTab={(id) => {
        setSearch('');
        go({ area: id as SettingsArea, slug: DEFAULT_SECTION[id as SettingsArea] });
      }}
      search={search}
      onSearch={setSearch}
      searchPlaceholder={t('search')}
      testId="settings-modal"
      nav={
        query ? (
          results.length + projectResults.length > 0 ? (
            <>
              {projectResults.map((page) => (
                <ModalNavItem
                  key={`project:${page.slug}`}
                  path={[
                    `${t('projectPath')} ${projectName ?? projectKey}`,
                    page.group ? tNav(page.group as never) : null,
                  ]
                    .filter(Boolean)
                    .join(' › ')}
                  onClick={() => {
                    setSearch('');
                    go(null);
                    window.setTimeout(() => router.push(page.href), 0);
                  }}
                >
                  {page.labelKey ? tNav(page.labelKey as never) : sectionText(page.slug).label}
                </ModalNavItem>
              ))}
              {results.map(({ item, area }) => (
                <ModalNavItem
                  key={`${area}:${item.slug}`}
                  active={area === activeArea && item.slug === activeSlug}
                  path={[t(`tabs.${area}`), item.group ? groupLabel(item.group) : null]
                    .filter(Boolean)
                    .join(' › ')}
                  onClick={() => {
                    setSearch('');
                    go({ area, slug: item.slug });
                  }}
                >
                  {label(item)}
                </ModalNavItem>
              ))}
            </>
          ) : (
            <p className="ds-modal-empty">{t('noResults')}</p>
          )
        ) : (
          groups.map((group) =>
            group ? (
              <ModalNavGroup key={group} label={groupLabel(group)}>
                {current
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <ModalNavItem
                      key={item.slug}
                      active={item.slug === activeSlug}
                      onClick={() => go({ area: activeArea, slug: item.slug })}
                    >
                      {label(item)}
                    </ModalNavItem>
                  ))}
              </ModalNavGroup>
            ) : (
              current
                .filter((item) => !item.group)
                .map((item) => (
                  <ModalNavItem
                    key={item.slug}
                    active={item.slug === activeSlug}
                    onClick={() => go({ area: activeArea, slug: item.slug })}
                  >
                    {label(item)}
                  </ModalNavItem>
                ))
            ),
          )
        )
      }
    >
      <div
        onClickCapture={keepLinksInModal}
        data-settings-area={activeArea}
        data-settings-section={activeSlug}
      >
        <header className="ds-modal-pane-head">
          <h2>{activeDef ? label(activeDef) : t('title')}</h2>
          {activeDef && description(activeDef) && <p>{description(activeDef)}</p>}
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
