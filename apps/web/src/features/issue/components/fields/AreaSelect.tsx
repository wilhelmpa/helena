import { CircleDashed, FolderKanban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ViewFolder } from '@/lib/api/endpoints/views';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick from '@/components/common/fields/PopoverPick';

// A Pill trigger opening the project's areas, to put an issue in one or take it out.
export default function AreaSelect({
  areas,
  value,
  onChange,
  readOnly,
}: {
  areas: ViewFolder[];
  value: number | null;
  onChange: (id: number | null) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations('issue.fieldSelects');
  const area = areas.find((a) => a.id === value);
  return (
    <PopoverPick
      readOnly={readOnly}
      trigger={
        <Pill active={!!area}>
          <FolderKanban />
          <span className="truncate">{area?.name ?? t('area')}</span>
        </Pill>
      }
      inputPlaceholder={t('changeArea')}
      items={[
        {
          key: 'none',
          search: t('noArea'),
          icon: <CircleDashed />,
          label: t('noArea'),
          selected: value == null,
          onSelect: () => onChange(null),
        },
        ...areas.map((a) => ({
          key: String(a.id),
          search: a.name,
          icon: <FolderKanban />,
          label: a.name,
          selected: a.id === value,
          onSelect: () => onChange(a.id),
        })),
      ]}
    />
  );
}
