'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { useProjectsQuery } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { dashboardsPath } from '@/utils/paths';
import { ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import ProjectSettingsModalContent from './ProjectSettingsModalContent';
import SettingsAreaContent from './SettingsAreaContent';
import {
  SETTINGS_MODAL_OPEN,
  SETTINGS_PARAM,
  parseSettingsParam,
  settingsModalRoute,
  settingsModalSections,
  withSettingsParam,
  type ModalSection,
  type OpenSettingsRequest,
  type SettingsArea,
  type SettingsLocation,
} from './settingsModalCatalog';

const returnKey = 'helena:settings-return';
const subscribeToMount = () => () => {};
const areaNames: Record<SettingsArea, string> = {
  project: 'Projekt',
  home: 'Home · alle Projekte',
  agent: 'Agenten',
  account: 'Mein Konto',
  admin: 'Administrator',
};

// Whether the modal put its own entry on the history stack, so closing takes it off
// again (Back then leaves the page instead of reopening the modal). One modal is open at
// a time, so this is module state rather than a ref.
let pushedEntry = false;

function currentHref() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

// The settings modal (ui-system §11, §13): one modal for every setting, over the page the
// user is on. Where it stands lives in the URL (`?settings=area.slug`, see
// settingsModalCatalog), set with the browser's own history so the page behind never
// navigates, reloads or re-renders another route: closing it leaves everything as it was,
// filters included. Old settings URLs (bookmarks, links in mails and pages) open the
// modal over the page the user came from, or the project's dashboard.
export default function SettingsModal({
  projectKey: currentProjectKey,
  projectName,
  teamId: currentTeamId,
}: {
  projectKey?: string | null;
  projectName?: string | null;
  teamId?: number | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const legacy = settingsModalRoute(pathname);
  const location = legacy ? null : parseSettingsParam(searchParams.get(SETTINGS_PARAM));
  const { data: session } = useSession();
  const projects = useProjectsQuery().data ?? [];
  const teams = useTeamsQuery().data ?? [];
  // Project settings need the project the page has loaded, so they are offered only
  // inside a project.
  const projectKey = currentProjectKey ?? null;
  const project = projects.find((entry) => entry.key === projectKey);
  const name = projectName ?? project?.name ?? projectKey ?? '';
  const teamId = currentTeamId ?? project?.teamId ?? teams[0]?.id ?? null;
  const admin = session?.user.role === 'god';
  const agentsQuery = useAiAgentsQuery(location ? teamId : null);
  const agents = useMemo(
    () =>
      [...(agentsQuery.data ?? [])].sort(
        (a, b) => Number(a.template) - Number(b.template) || a.name.localeCompare(b.name),
      ),
    [agentsQuery.data],
  );
  const sections = useMemo(() => {
    const base = settingsModalSections(projectKey, teamId, admin);
    return {
      ...base,
      agent: agents.map((agent): ModalSection => ({
        slug: String(agent.id),
        label: agent.name,
        description: agent.username ? `@${agent.username}` : '',
        href: '',
      })),
    };
  }, [projectKey, teamId, admin, agents]);
  const mounted = useSyncExternalStore(
    subscribeToMount,
    () => true,
    () => false,
  );
  const [search, setSearch] = useState('');
  const [showMore, setShowMore] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const allAreas = useMemo(
    () =>
      (['project', 'home', 'agent', 'account', 'admin'] as SettingsArea[]).filter((area) =>
        area === 'project'
          ? !!projectKey
          : area === 'home' || area === 'agent'
            ? teamId != null
            : area === 'admin'
              ? admin
              : true,
      ),
    [admin, projectKey, teamId],
  );

  const defaultSlug = useCallback(
    (area: SettingsArea) =>
      area === 'project'
        ? 'agents'
        : area === 'home'
          ? admin
            ? 'defaults'
            : 'info'
          : area === 'agent'
            ? (sections.agent[0]?.slug ?? '')
            : area === 'account'
              ? 'profile'
              : 'general',
    [admin, sections.agent],
  );

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

  // An old settings URL: back to the page before (or the project's dashboard), with the
  // modal open there.
  useEffect(() => {
    if (!legacy) return;
    const projectOfPath = pathname.match(/^\/project\/([^/]+)/)?.[1] ?? null;
    let back = sessionStorage.getItem(returnKey);
    const backPath = back?.split(/[?#]/)[0] ?? '';
    if (
      !back ||
      settingsModalRoute(backPath) ||
      (projectOfPath && !backPath.startsWith(`/project/${projectOfPath}`))
    ) {
      back = projectOfPath ? dashboardsPath(decodeURIComponent(projectOfPath)) : '/';
    }
    router.replace(withSettingsParam(back, legacy), { scroll: false });
  }, [legacy, pathname, router]);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<OpenSettingsRequest | undefined>).detail ?? {};
      let area: SettingsArea =
        detail.scope ??
        (detail.agentId != null
          ? 'agent'
          : currentProjectKey
            ? 'project'
            : teamId
              ? 'home'
              : 'account');
      if (!allAreas.includes(area)) area = allAreas.includes('home') ? 'home' : 'account';
      const slug =
        area === 'agent' && detail.agentId != null
          ? String(detail.agentId)
          : (detail.section ?? defaultSlug(area));
      const extra = area === 'home' && detail.teamId != null ? String(detail.teamId) : detail.tab;
      setSearch('');
      go({ area, slug, ...(extra ? { extra } : {}) });
    }
    window.addEventListener(SETTINGS_MODAL_OPEN, handleOpen);
    return () => window.removeEventListener(SETTINGS_MODAL_OPEN, handleOpen);
  }, [allAreas, currentProjectKey, defaultSlug, go, teamId]);

  const visible = !!location;
  const activeArea = location && allAreas.includes(location.area) ? location.area : null;
  const activeSlug = location?.slug ?? '';
  const activeSection = activeArea
    ? sections[activeArea].find((item) => item.slug === activeSlug)
    : undefined;

  useEffect(() => {
    if (!visible) return;
    navRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [activeArea, activeSlug, visible]);

  const close = useCallback(() => go(null), [go]);

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
    go({ area: itemArea, slug: item.slug });
  }

  function selectArea(nextArea: SettingsArea) {
    setSearch('');
    go({ area: nextArea, slug: defaultSlug(nextArea) });
  }

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
    const targetProject = url.pathname.match(/^\/project\/([^/]+)/)?.[1];
    if (
      target.area === 'project' &&
      targetProject &&
      decodeURIComponent(targetProject) !== projectKey
    )
      return;
    event.preventDefault();
    go(target);
  }

  if (!mounted || !visible) return null;

  const query = search.trim().toLocaleLowerCase();
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
  const areaSections = activeArea ? sections[activeArea] : [];
  const primaryCount =
    activeArea === 'project'
      ? 11
      : activeArea === 'agent'
        ? agents.filter((a) => !a.template).length
        : areaSections.length;
  const primarySections = areaSections.slice(0, primaryCount);
  const extraSections = areaSections.slice(primaryCount);

  return createPortal(
    <div className="settings-modal-layer" data-testid="settings-modal-layer">
      <div className="settings-modal-scrim" onClick={close} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Einstellungen"
        className="settings-modal dark"
        data-testid="settings-modal"
        data-settings-area={activeArea ?? undefined}
        data-settings-section={activeSlug}
        onClickCapture={keepLinksInModal}
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
                    onClick={() => activeArea && select(item, activeArea)}
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
                    <summary>
                      {activeArea === 'agent' ? 'Vorlagen' : 'Weitere Einstellungen'}
                    </summary>
                    {extraSections.map((item) => (
                      <button
                        key={item.slug}
                        type="button"
                        onClick={() => activeArea && select(item, activeArea)}
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
              {(activeArea === 'project'
                ? name
                : activeArea
                  ? areaNames[activeArea]
                  : ''
              ).toLocaleUpperCase()}
              {' · EINSTELLUNGEN'}
            </p>
            <h2>{activeSection?.label ?? 'Einstellungen'}</h2>
            <div className="settings-modal-existing">
              <ShellHeaderSlotCtx.Provider value={null}>
                {activeArea === 'project' ? (
                  <ProjectSettingsModalContent slug={activeSlug} />
                ) : activeArea && location ? (
                  <SettingsAreaContent location={location} teamId={teamId} />
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
