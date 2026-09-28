'use client';

import {
  useCallback,
  useEffect,
  useMemo,
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
  routeContent,
}: {
  projectKey?: string | null;
  projectName?: string | null;
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
    Number.isInteger(pathTeamId) && pathTeamId > 0 ? pathTeamId : (teams[0]?.id ?? null);
  const sections = useMemo(() => settingsModalSections(projectKey, teamId), [projectKey, teamId]);
  const admin = session?.user.role === 'god';
  const mounted = useSyncExternalStore(
    subscribeToMount,
    () => true,
    () => false,
  );
  const [opened, setOpened] = useState(false);
  const [area, setArea] = useState<SettingsArea>(projectKey ? 'project' : 'home');
  const [slug, setSlug] = useState('general');
  const [search, setSearch] = useState('');

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<{ area?: SettingsArea; slug?: string }>).detail;
      const nextArea =
        detail?.area ?? (currentProjectKey ? 'project' : teamId ? 'home' : 'account');
      const nextSlug = detail?.slug ?? (nextArea === 'project' ? 'general' : 'info');
      if (!route) sessionStorage.setItem(returnKey, pathname);
      if (nextArea !== 'project' || !currentProjectKey) {
        const target = sections[nextArea][0];
        if (target) router.push(target.href);
        return;
      }
      setArea(nextArea);
      setSlug(nextSlug);
      setSearch('');
      setOpened(true);
    }
    window.addEventListener(SETTINGS_MODAL_OPEN, handleOpen);
    return () => window.removeEventListener(SETTINGS_MODAL_OPEN, handleOpen);
  }, [currentProjectKey, pathname, route, router, sections, teamId]);

  const activeArea = route?.area ?? area;
  const activeSlug = route?.slug ?? slug;
  const visible = opened || !!route;
  const activeSection = sections[activeArea].find((item) => item.slug === activeSlug);

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
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', handleEscape, true);
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
    const first = sections[nextArea][0];
    if (!first) return;
    if (!route && nextArea === 'project' && currentProjectKey) {
      setArea('project');
      setSlug('general');
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
          .filter((item) => `${item.label} ${item.description}`.toLocaleLowerCase().includes(query))
          .map((item) => ({ ...item, area: itemArea })),
      )
    : [];

  return createPortal(
    <div className="settings-modal-layer" data-testid="settings-modal-layer">
      <div className="settings-modal-scrim" onClick={close} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Einstellungen"
        className="settings-modal dark"
        data-testid="settings-modal"
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
          <nav className="settings-modal-nav" aria-label="Einstellungsabschnitte">
            {query
              ? results.map((item) => (
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
              : sections[activeArea].map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => select(item, activeArea)}
                    className={`${item.slug === activeSlug ? 'is-active' : ''} ${item.slug === 'danger-zone' ? 'is-danger' : ''}`}
                  >
                    {item.label}
                  </button>
                ))}
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
            <p className="settings-modal-save-note">{'Änderungen werden sofort gespeichert.'}</p>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
