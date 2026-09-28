import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ViewTemplate } from '@/hooks/useViewEditor';
import { useCreateViewFolder, useViewFoldersQuery } from '@/services/views.service';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import AreaDialog from '@/components/layout/AreaDialog';

// The "+" of "Aufgaben" in the sidebar: a new view (from the current one or a template)
// or a new group that views can be put into (docs/design-system.md §7).
export default function NewViewMenu({
  projectKey,
  onSelect,
}: {
  projectKey: string;
  onSelect: (template: ViewTemplate) => void;
}) {
  const t = useTranslations('views');
  const [open, setOpen] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const { data: folders = [] } = useViewFoldersQuery(projectKey);
  const createFolder = useCreateViewFolder(projectKey);
  return (
    <>
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
        <PopoverContent align="start" className="ds-menu-list">
          {(['current', 'mine', 'open', 'week', 'status'] as const).map((template) => (
            <button
              key={template}
              type="button"
              onClick={() => {
                onSelect(template);
                setOpen(false);
              }}
            >
              {template === 'current' ? t('saveAsNew') : t(`templates.${template}`)}
            </button>
          ))}
          <hr />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setNewGroup(true);
            }}
          >
            {t('newFolder')}
          </button>
        </PopoverContent>
      </Popover>
      {newGroup && (
        <AreaDialog
          title={t('newFolder')}
          description={t('newFolderDescription')}
          submitLabel={t('create')}
          areas={folders}
          onSubmit={(input) => createFolder.mutateAsync(input)}
          onClose={() => setNewGroup(false)}
        />
      )}
    </>
  );
}
