'use client';

import { Component, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CircleSlash } from 'lucide-react';
import { resolveText } from '@helena/sdk/web';
import { RowEmpty } from '@/components/common/page/RowList';
import { byKey } from '@/utils/messageKey';
import type { DashboardWidget } from '@/extensions/dashboardWidgets';
import { DashboardSection, FigureTile, SkeletonRows } from './DashboardParts';

// A widget's name in the reader's language: a built-in's from the message files, a
// plugin's from the texts it brings.
export function useWidgetLabel(): (widget: Pick<DashboardWidget, 'label'>) => string {
  const t = byKey(useTranslations());
  const locale = useLocale();
  return (widget) => resolveText(widget.label, locale, (key) => t(key));
}

// A widget that throws takes only its own place down, never Start.
class WidgetBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('Start widget failed:', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Where a widget sits while Start does not know the reader's arrangement yet: a tile or a
// section of its own size, so nothing moves when the widgets arrive.
export function WidgetPlaceholder({ widget }: { widget: DashboardWidget }) {
  const label = useWidgetLabel();
  if (widget.kind === 'figure') return <FigureTile label={label(widget)} value={null} />;
  return (
    <DashboardSection label={label(widget)}>
      <SkeletonRows count={widget.rows} />
    </DashboardSection>
  );
}

// One widget: a built-in's component, or a plugin's page in a sandboxed frame (one tile
// high, or the section's rows high).
export default function WidgetView({ widget }: { widget: DashboardWidget }) {
  const label = useWidgetLabel();
  const t = useTranslations('home');
  const fallback =
    widget.kind === 'figure' ? (
      <FigureTile label={label(widget)} value="–" sub={t('widgetFailed')} />
    ) : (
      <DashboardSection label={label(widget)}>
        <RowEmpty icon={<CircleSlash />}>{t('widgetFailed')}</RowEmpty>
      </DashboardSection>
    );
  if (widget.view.kind === 'frame') {
    const frame = (
      <iframe
        src={widget.view.url}
        title={label(widget)}
        sandbox="allow-scripts allow-forms"
        className="block w-full rounded-md border-0"
        style={{ height: widget.kind === 'figure' ? 80 : widget.rows * 32 }}
      />
    );
    return widget.kind === 'figure' ? (
      <div className="min-w-0 overflow-hidden rounded-lg border border-sidebar-border bg-card">
        {frame}
      </div>
    ) : (
      <DashboardSection label={label(widget)}>{frame}</DashboardSection>
    );
  }
  const View = widget.view.component;
  return (
    <WidgetBoundary fallback={fallback}>
      <View />
    </WidgetBoundary>
  );
}
