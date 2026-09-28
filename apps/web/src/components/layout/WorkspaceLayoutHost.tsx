'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { WorkspaceLayoutState } from '@/hooks/useWorkspaceLayout';
import { SidePanel } from '@/design-system';
import WorkspacePanel, { type PanelArea } from './WorkspacePanel';

// The room under the page header (docs/design-system.md §3, owner 28.09. 10:00): the
// page always has the full width, and the tool panel — chat, terminal, code, browser,
// mail — is an overlay over it on the right, with the width the user dragged, or full
// screen. Closed, it is not there at all. The panel's frames stay mounted while it is
// open (WorkspacePanel), so switching tabs reloads nothing.
export default function WorkspaceLayoutHost({
  layout,
  projectKey,
  children,
}: {
  layout: WorkspaceLayoutState;
  projectKey: string | null;
  // The page.
  children: ReactNode;
}) {
  const t = useTranslations('nav.panelTabs');
  const { resolved, panel } = layout;
  const [fullScreen, setFull] = useState(false);
  const mainArea = resolved.areas.find((area) => area.main && area.tool);
  const open = panel.open && !!mainArea;
  // Full screen belongs to the open panel; closed, it starts as the overlay again.
  const full = open && fullScreen;
  const areasJson = JSON.stringify(
    mainArea?.tool ? [{ id: mainArea.id, tool: mainArea.tool, main: true, column: 1 }] : [],
  );
  const toolAreas = useMemo(() => JSON.parse(areasJson) as PanelArea[], [areasJson]);

  // Esc: out of full screen first, then the panel closes — unless a menu, a dialog or a
  // field inside the page has it.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"], [data-slot="select-content"][data-state="open"], .ds-modal-layer',
        )
      )
        return;
      const target = event.target as Element | null;
      const inPanel = !!target?.closest('.ds-side-panel');
      if (!inPanel && target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (full) setFull(false);
      else panel.setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, open, panel]);

  return (
    <div className="ds-page-content" data-workspace-layout="standard">
      {children}
      <SidePanel open={open} full={full} label={t('tabs')}>
        <WorkspacePanel
          areas={toolAreas}
          contextProjectKey={projectKey}
          toolSession={panel.toolSession}
          mode="overlay"
          overlay
          full={full}
          closable
          onToggleMode={panel.toggleMode}
          onToggleFull={() => setFull((value) => !value)}
          onPickTool={layout.pickTool}
          onCloseArea={layout.closeArea}
          onClose={() => {
            setFull(false);
            panel.setOpen(false);
          }}
          tabs={layout.tabs}
          activeTool={panel.activeTool}
          layoutId={full ? 'tool-full' : 'standard'}
          onSelectTab={layout.activateTab}
          onCloseTab={layout.closeTab}
          onChooseLayout={(choice) => setFull(choice === 'full' ? !full : false)}
        />
      </SidePanel>
    </div>
  );
}
