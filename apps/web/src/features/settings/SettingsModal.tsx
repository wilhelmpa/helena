'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { useProjectsQuery } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import { ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import ProjectSettingsModalContent from './ProjectSettingsModalContent';
import {
  SETTINGS_MODAL_OPEN,
  settingsModalRoute,
  settingsModalSections,
  type ModalSection,
  type SettingsArea,
} from './settingsModalCatalog';

const returnKey = 'helena:settings-return';
const subscribeToMount = () => () => {};
const areaNames: Record<SettingsArea, string> = {
  project: 'Projekt',
  home: 'Home · alle Projekte',
  account: 'Mein Konto',
  admin: 'Administrator',
};

export default function SettingsModal({
  projectKey: currentProjectKey,
  projectName,
  teamId: currentTeamId,
  routeContent,
}: {
  projectKey?: string | null;
  projectName?: string | null;
  teamId?: number | null;
  routeContent?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const route = settingsModalRoute(pathname);
  const { data: session } = useSession();
  const projects = useProjectsQuery().data ?? [];
  const teams = useTeamsQuery().data ?? [];
  const pathProjectKey = pathname.match(/^\/project\/([^/]+)/)?.[1] ?? null;
  const projectKey = currentProjectKey ?? pathProjectKey ?? projects[0]?.key ?? null;
  const project = projects.find((entry) => entry.key === projectKey);
  const name = projectName ?? project?.name ?? projectKey ?? '';
  const pathTeamId = Number(pathname.match(/^\/account\/teams\/(\d+)/)?.[1]);
  const teamId =
    currentTeamId ??
    (Number.isInteger(pathTeamId) && pathTeamId > 0 ? pathTeamId : (teams[0]?.id ?? null));
  const admin = session?.user.role === 'god';
  const sections = useMemo(
    () => settingsModalSections(projectKey, teamId, admin),
    [projectKey, teamId, admin],
  );
  const mounted = useSyncExternalStore(
    subscribeToMount,
    () => true,
    () => false,
  );
  const [opened, setOpened] = useState(false);
  const [area, setArea] = useState<SettingsArea>(projectKey ? 'project' : 'home');
  const [slug, setSlug] = useState('agents');
  const [search, setSearch] = useState('');
  const [showMore, setShowMore] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<{ area?: SettingsArea; slug?: string }>).detail;
      const nextArea =
        detail?.area ?? (currentProjectKey ? 'project' : teamId ? 'home' : 'account');
      const nextSlug =
        detail?.slug ??
        (nextArea === 'project'
          ? 'agents'
          : nextArea === 'home'
            ? admin
              ? 'defaults'
              : 'info'
            : nextArea === 'account'
              ? 'profile'
              : 'general');
      if (!route) sessionStorage.setItem(returnKey, pathname);
      if (nextArea !== 'project' || !currentProjectKey) {
        const target =
          sections[nextArea].find((item) => item.slug === nextSlug) ?? sections[nextArea][0];
        if (target) router.push(target.href);
        else if (nextArea === 'home') router.push('/account/teams');
        return;
      }
      setArea(nextArea);
      setSlug(nextSlug);
      setSearch('');
      setOpened(true);
    }
    window.addEventListener(SETTINGS_MODAL_OPEN, handleOpen);
    return () => window.removeEventListener(SETTINGS_MODAL_OPEN, handleOpen);
  }, [admin, currentProjectKey, pathname, route, router, sections, teamId]);

  const activeArea = route?.area ?? area;
  const activeSlug = route?.slug ?? slug;
  const visible = opened || !!route;
  const activeSection = sections[activeArea].find((item) => item.slug === activeSlug);

  useEffect(() => {
    if (!visible) return;
    navRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [activeArea, activeSlug, visible]);

  const close = useCallback(() => {
    setOpened(false);
    if (!route) {
      return;
    }
    const saved = sessionStorage.getItem(returnKey);
    sessionStorage.removeItem(returnKey);
    const fallback = route.area === 'project' && projectKey ? `/project/${projectKey}` : '/';
    router.push(saved && !settingsModalRoute(saved) && saved !== pathname ? saved : fallback);
  }, [pathname, projectKey, route, router]);

  useEffect(() => {
    if (!visible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.dataset.settingsModalOpen = 'true';
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (
        document.querySelector(
          '[data-slot="dialog-content"][data-state="open"], [data-slot="select-content"][data-state="open"], [data-slot="dropdown-menu-content"][data-state="open"], [data-slot="popover-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previous;
      delete document.body.dataset.settingsModalOpen;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [close, visible]);

  function select(item: ModalSection, itemArea: SettingsArea) {
    setSearch('');
    if (!route && itemArea === 'project' && currentProjectKey) {
      setArea('project');
      setSlug(item.slug);
      return;
    }
    router.push(item.href);
  }

  function selectArea(nextArea: SettingsArea) {
    const first =
      nextArea === 'home' && !admin
        ? sections.home.find((item) => item.slug === 'info')
        : sections[nextArea][0];
    if (!first) {
      if (nextArea === 'home') router.push('/account/teams');
      return;
    }
    if (!route && nextArea === 'project' && currentProjectKey) {
      setArea('project');
      setSlug('agents');
      return;
    }
    router.push(first.href);
  }

  if (!mounted || !visible) return null;

  const query = search.trim().toLocaleLowerCase();
  const allAreas: SettingsArea[] = admin
    ? ['project', 'home', 'account', 'admin']
    : ['project', 'home', 'account'];
  const results = query
    ? allAreas.flatMap((itemArea) =>
        sections[itemArea]
          .filter((item) =>
            `${item.label} ${item.description} ${item.keywords ?? ''}`
              .toLocaleLowerCase()
              .includes(query),
          )
          .map((item) => ({ ...item, area: itemArea })),
      )
    : [];
  const primarySections =
    activeArea === 'project' ? sections.project.slice(0, 11) : sections[activeArea];
  const extraSections = activeArea === 'project' ? sections.project.slice(11) : [];

  return createPortal(
    <div className="settings-modal-layer" data-testid="settings-modal-layer">
      <div className="settings-modal-scrim" onClick={close} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Einstellungen"
        className="settings-modal dark"
        data-testid="settings-modal"
        data-settings-area={activeArea}
        data-settings-section={activeSlug}
      >
        <header className="settings-modal-header">
          <div className="settings-modal-tabs" role="tablist" aria-label="Einstellungsbereich">
            {allAreas.map((itemArea) => (
              <button
                type="button"
                role="tab"
                aria-selected={itemArea === activeArea}
                key={itemArea}
                className={itemArea === activeArea ? 'is-active' : ''}
                onClick={() => selectArea(itemArea)}
              >
                {itemArea === 'project' && <span className="settings-modal-dot project" />}
                {itemArea === 'home' && <span className="settings-modal-dot home" />}
                {itemArea === 'project' ? `Projekt ${name}` : areaNames[itemArea]}
              </button>
            ))}
          </div>
          <div className="settings-modal-search-wrap">
            <label className="settings-modal-search">
              <span aria-hidden="true">{'⌕'}</span>
              <input
                aria-label="Einstellung suchen"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Einstellung suchen …"
              />
            </label>
            <button
              type="button"
              className="settings-modal-esc"
              onClick={close}
              aria-label="Schließen"
            >
              {'ESC'}
            </button>
          </div>
        </header>
        <div className="settings-modal-main">
          <nav ref={navRef} className="settings-modal-nav" aria-label="Einstellungsabschnitte">
            {query ? (
              results.map((item) => (
                <button
                  key={`${item.area}:${item.slug}`}
                  type="button"
                  onClick={() => select(item, item.area)}
                  className={
                    item.area === activeArea && item.slug === activeSlug ? 'is-active' : ''
                  }
                >
                  <small>{areaNames[item.area]}</small>
                  {item.label}
                </button>
              ))
            ) : (
              <>
                {primarySections.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => select(item, activeArea)}
                    className={`${item.slug === activeSlug ? 'is-active' : ''} ${item.slug === 'danger-zone' ? 'is-danger' : ''}`}
                  >
                    {item.label}
                  </button>
                ))}
                {extraSections.length > 0 && (
                  <details
                    className="settings-modal-more"
                    open={showMore || extraSections.some((item) => item.slug === activeSlug)}
                    onToggle={(event) => setShowMore(event.currentTarget.open)}
                  >
                    <summary>{'Weitere Einstellungen'}</summary>
                    {extraSections.map((item) => (
                      <button
                        key={item.slug}
                        type="button"
                        onClick={() => select(item, activeArea)}
                        className={item.slug === activeSlug ? 'is-active' : ''}
                      >
                        {item.label}
                      </button>
                    ))}
                  </details>
                )}
              </>
            )}
          </nav>
          <div className="settings-modal-pane">
            <p className="settings-modal-eyebrow">
              {(activeArea === 'project' ? name : areaNames[activeArea]).toLocaleUpperCase()}
              {' · EINSTELLUNGEN'}
            </p>
            <h2>{activeSection?.label ?? 'Einstellungen'}</h2>
            <div className="settings-modal-existing">
              <ShellHeaderSlotCtx.Provider value={null}>
                {route && routeContent ? (
                  routeContent
                ) : activeArea === 'project' ? (
                  <ProjectSettingsModalContent slug={activeSlug} />
                ) : null}
              </ShellHeaderSlotCtx.Provider>
            </div>
            {((activeArea === 'project' &&
              ['general', 'autopilot', 'budgets', 'browser'].includes(activeSlug)) ||
              (activeArea === 'home' && ['defaults', 'info'].includes(activeSlug)) ||
              (activeArea === 'account' && activeSlug === 'profile')) && (
              <p className="settings-modal-save-note">{'Änderungen werden sofort gespeichert.'}</p>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
