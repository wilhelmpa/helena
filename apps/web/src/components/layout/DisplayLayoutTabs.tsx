import { useTranslations } from 'next-intl';
import { byKey } from '@/utils/messageKey';
import { useHotkeyFormatter } from '@/context/useHotkeys';
import { VIEWS, type WorkItemsView } from '@/utils/viewTypes';
import { Segmented } from '@/design-system';

// The layout switcher at the top of the Display settings: one tab per work items
// layout, the active one showing its label. The hotkey is appended to the tooltip
// when the layout has one bound.
export default function DisplayLayoutTabs({
  view,
  onViewChange,
}: {
  view: WorkItemsView;
  onViewChange: (view: WorkItemsView) => void;
}) {
  const t = byKey(useTranslations('display.layouts'));
  const tDisplay = useTranslations('display');
  const hotkey = useHotkeyFormatter();

  return (
    // The same segment control as every view switch (O20): the active layout with its
    // name, the others as icons with the name (and hotkey) in their tooltip.
    <Segmented<WorkItemsView>
      label={tDisplay('title')}
      value={view}
      onChange={onViewChange}
      className="w-full"
      options={VIEWS.map(({ value, icon: Icon, hotkey: id }) => {
        const label = t(value);
        return {
          value,
          icon: <Icon aria-hidden="true" />,
          label: value === view ? label : <span className="sr-only">{label}</span>,
          title: hotkey(id) ? `${label} (${hotkey(id)})` : label,
        };
      })}
    />
  );
}
