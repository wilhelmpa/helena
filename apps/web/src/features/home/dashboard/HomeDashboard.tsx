'use client';

import { useTranslations } from 'next-intl';
import { SlidersHorizontal } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { PageActions, PageToolbar } from '@/components/layout/PageToolbar';
import type { DashboardWidget } from '@/extensions/dashboardWidgets';
import { usePluginDashboardWidgets } from '@/extensions/pluginDashboardWidgets';
import '@/extensions/homeWidgets';
import { useToday } from '../hooks/useToday';
import CustomizeDialog from './CustomizeDialog';
import SystemDetailsDialog from './SystemDetailsDialog';
import WidgetView, { WidgetPlaceholder } from './WidgetView';
import { columnsOf, sectionBlocks, type Arranged } from './layout';
import { HomeDashboardProvider, useHomeDashboard, useHomeDashboardValue } from './useHomeDashboard';

// The figure row: an auto-fit grid of tiles at least 160px wide that wraps to a second row
// instead of scrolling; two columns on a phone.
const FIGURE_ROW = 'grid grid-cols-2 gap-[14px] @4xl:grid-cols-4';

// A pair block of half-width sections: two columns on a wide screen (first, third, … left),
// one column in the reader's order below that. The columns are `display: contents` when
// narrow, so every section sorts by its place in the reader's order.
function SectionPair({
  items,
  render,
}: {
  items: DashboardWidget[];
  render: (widget: DashboardWidget) => ReactNode;
}) {
  const columns = columnsOf(items);
  return (
    <div className="flex flex-col gap-4 @4xl:grid @4xl:grid-cols-2 @4xl:items-start">
      {columns.map((column, side) => (
        <div key={side} className="contents @4xl:flex @4xl:flex-col @4xl:gap-4">
          {column.map((widget) => (
            <div key={widget.id} className="min-w-0" style={{ order: items.indexOf(widget) }}>
              {render(widget)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Sections({
  sections,
  render,
}: {
  sections: Arranged<DashboardWidget>[];
  render: (widget: DashboardWidget) => ReactNode;
}) {
  const blocks = sectionBlocks(
    sections.filter((entry) => entry.visible).map((entry) => entry.widget),
  );
  return (
    <>
      {blocks.map((block) =>
        block.kind === 'full' ? (
          <div key={block.item.id} id={block.item.id} className="min-w-0 scroll-mt-4">
            {render(block.item)}
          </div>
        ) : (
          <SectionPair key={block.items[0]!.id} items={block.items} render={render} />
        ),
      )}
    </>
  );
}

// Start (owner, 2026-09-24, direction C "Kennzahlen und Heute"; docs/helena-decisions/
// dashboard.md): the page toolbar holds today's date and "Anpassen"; a row of figure tiles
// (who works, the reader's tasks, every plan limit, the system, updates …),
// and below it the sections ("Meine Aufgaben", "Läuft gerade", "Als
// Nächstes", "Projekte"). Every tile and section is a widget of the registry
// (extensions/dashboardWidgets); the reader hides and orders them in "Anpassen".
export default function HomeDashboard() {
  const t = useTranslations('home');
  const today = useToday();
  const [customizing, setCustomizing] = useState(false);
  usePluginDashboardWidgets();
  const dashboard = useHomeDashboard();
  const context = useHomeDashboardValue(dashboard);
  const { ready, figures, sections, prefs, save, owner } = dashboard;
  const render = (widget: DashboardWidget) =>
    ready ? <WidgetView widget={widget} /> : <WidgetPlaceholder widget={widget} />;

  return (
    <HomeDashboardProvider value={context}>
      <PageToolbar>
        <span className="h-4 truncate px-1 text-xs text-muted-foreground">{today}</span>
        <PageActions
          actions={[
            {
              id: 'customize',
              label: t('customize.title'),
              icon: SlidersHorizontal,
              onClick: () => setCustomizing(true),
              disabled: !ready,
            },
          ]}
        />
      </PageToolbar>
      {/* The page's header names it (Helena / Alle Projekte); the body starts with figures. */}
      <div className="ds-dashboard-body @container">
        <div className={FIGURE_ROW}>
          {figures
            .filter((entry) => entry.visible)
            .map((entry) => (
              // A figure widget renders its tiles straight into the row: one widget may
              // bring several (the plan limits, one per subscription) or none.
              <Fragment key={entry.widget.id}>
                {entry.widget.id === 'system' ? (
                  <div id="system" className="min-w-0 scroll-mt-4">
                    {render(entry.widget)}
                  </div>
                ) : (
                  render(entry.widget)
                )}
              </Fragment>
            ))}
        </div>
        <Sections sections={sections} render={render} />
      </div>
      <CustomizeDialog
        open={customizing}
        onOpenChange={setCustomizing}
        figures={figures}
        sections={sections}
        prefs={prefs}
        onChange={save}
      />
      {owner && <SystemDetailsDialog />}
    </HomeDashboardProvider>
  );
}
