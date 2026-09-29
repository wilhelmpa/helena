'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Code2,
  Globe2,
  Mail,
  Maximize2,
  Pin,
  PinOff,
  MessageSquare,
  Minimize2,
  Plus,
  Terminal,
  X,
} from 'lucide-react';
import { useBrowserControl } from '@/hooks/useBrowserControl';
import { useOfferedPanelTools } from '@/extensions/panelTools';
import { usePanelToolLabel } from '@/extensions/pluginPanelTools';
import { orderWorkspaceTabs, type useWorkspaceTabs } from '@/hooks/useWorkspaceTabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Tabs = ReturnType<typeof useWorkspaceTabs>;
type LayoutChoice = 'side' | 'split' | 'full';

const tools = {
  chat: MessageSquare,
  browser: Globe2,
  terminal: Terminal,
  code: Code2,
  mail: Mail,
} as const;

export default function WorkspaceTabBar({
  tabs,
  activeTool,
  browserBase,
  layoutId,
  onSelectTool,
  onCloseTab,
  onChooseLayout,
  onClose,
  pinned = false,
  onTogglePin,
}: {
  tabs: Tabs;
  activeTool: string;
  browserBase: string | null;
  layoutId: string;
  onSelectTool: (tool: string) => void;
  onCloseTab: (key: string) => void;
  onChooseLayout: (choice: LayoutChoice) => void;
  onClose: () => void;
  // Pinned, the panel docks beside the page and the page shrinks to the room left
  // (owner, O31); unpinned it floats over the page.
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const t = useTranslations('nav.panelTabs');
  const tNav = useTranslations('nav');
  const browser = useBrowserControl(browserBase ?? '');
  const offered = useOfferedPanelTools();
  const labelOf = usePanelToolLabel();
  const [dragged, setDragged] = useState<string | null>(null);
  const browserKeys = browser.tabs.map((tab) => `browser:${tab.id}`);
  const browserIds = browser.tabs.map((tab) => tab.id);
  const browserIdList = browserIds.join('\u0000');
  useEffect(() => {
    if (browser.ready) tabs.rememberBrowser(browserIdList ? browserIdList.split('\u0000') : []);
  }, [browser.ready, browserIdList, tabs]);

  const available = [
    ...tabs.saved.filter(
      (key) => key.startsWith('tool:') && (key !== 'tool:browser' || browserKeys.length === 0),
    ),
    ...browserKeys,
  ];
  const ordered = orderWorkspaceTabs(available, tabs.saved);
  const activeBrowser = browser.tabs.find((tab) => tab.active) ?? browser.tabs[0];
  const activeKey =
    activeTool === 'browser' && activeBrowser
      ? `browser:${activeBrowser.id}`
      : `tool:${activeTool}`;
  const layout: LayoutChoice =
    layoutId === 'tool-full' ? 'full' : layoutId === 'page-tool-half' ? 'split' : 'side';

  const select = (key: string) => {
    if (key.startsWith('browser:')) {
      browser.act({ action: 'activate', id: key.slice(8) });
      onSelectTool('browser');
    } else onSelectTool(key.slice(5));
  };
  const close = (key: string) => {
    if (key.startsWith('browser:')) browser.act({ action: 'close', id: key.slice(8) });
    else onCloseTab(key);
  };
  const addBrowser = () => {
    onSelectTool('browser');
    if (browserBase) browser.act({ action: 'new' });
  };

  return (
    <div className="ds-panel-head">
      <div role="tablist" aria-label={t('tabs')} className="ds-panel-tabs">
        <div className="ds-panel-tabs-track">
          {ordered.map((key) => {
            const browserTab = key.startsWith('browser:')
              ? browser.tabs.find((tab) => tab.id === key.slice(8))
              : null;
            const tool = key.startsWith('browser:') ? 'browser' : key.slice(5);
            const definition = tools[tool as keyof typeof tools];
            const registered = offered.find((entry) => entry.id === tool);
            const Icon = definition ?? registered?.Icon ?? Globe2;
            const builtInLabel =
              tool === 'chat'
                ? tNav('sidebarHome')
                : tool === 'browser'
                  ? tNav('workspace.browser')
                  : tool === 'terminal'
                    ? tNav('workspace.terminal')
                    : tool === 'code'
                      ? tNav('workspace.code')
                      : tool === 'mail'
                        ? 'Mail'
                        : null;
            const label = browserTab?.title || builtInLabel || labelOf(registered) || tool;
            return (
              <div
                key={key}
                className="ds-panel-tab"
                draggable
                onDragStart={(event) => {
                  setDragged(key);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', key);
                  event.dataTransfer.setData('application/x-helena-tab', key);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged) tabs.move(dragged, key, ordered);
                  setDragged(null);
                }}
                onDragEnd={() => setDragged(null)}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeKey === key}
                  className="ds-panel-tab-select"
                  onClick={() => select(key)}
                  title={label}
                >
                  {tool === 'chat' ? (
                    <span className="ds-tool-orb" aria-hidden="true" />
                  ) : (
                    <Icon className="size-3.5" />
                  )}
                  <span>{label}</span>
                </button>
                <button
                  type="button"
                  className="ds-panel-tab-close"
                  aria-label={t('closeTab', { tab: label })}
                  onClick={() => close(key)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="ds-icon-button"
            data-size="small"
            title={t('addTab')}
            aria-label={t('addTab')}
          >
            <Plus size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {offered.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onSelect={() => (entry.id === 'browser' ? addBrowser() : onSelectTool(entry.id))}
              >
                <entry.Icon className="size-4" />
                {entry.id === 'chat'
                  ? tNav('sidebarHome')
                  : entry.id === 'browser'
                    ? t('browserTab')
                    : labelOf(entry)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="ds-panel-head-tools">
        {onTogglePin && layout !== 'full' && (
          <button
            type="button"
            className="ds-icon-button ds-panel-pin"
            aria-label={pinned ? t('unpin') : t('pin')}
            title={pinned ? t('unpin') : t('pin')}
            aria-pressed={pinned}
            onClick={onTogglePin}
          >
            {pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
        )}
        <button
          type="button"
          className="ds-icon-button"
          aria-label={layout === 'full' ? t('side') : t('full')}
          title={layout === 'full' ? t('side') : t('full')}
          aria-pressed={layout === 'full'}
          onClick={() => onChooseLayout('full')}
        >
          {layout === 'full' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          type="button"
          className="ds-icon-button"
          aria-label={t('close')}
          title={t('close')}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
