import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ViewTemplate } from '@/hooks/useViewEditor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export default function NewViewMenu({ onSelect }: { onSelect: (template: ViewTemplate) => void }) {
  const t = useTranslations('views');
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ds-tree-action"
          aria-label={t('newView')}
          title={t('newView')}
        >
          <Plus size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {(['current', 'mine', 'open', 'week', 'status'] as const).map((template) => (
          <button
            key={template}
            type="button"
            className="flex w-full rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            onClick={() => {
              onSelect(template);
              setOpen(false);
            }}
          >
            {template === 'current' ? t('saveAsNew') : t(`templates.${template}`)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
