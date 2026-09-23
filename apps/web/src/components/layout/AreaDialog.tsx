import { type FormEvent, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ViewFolder, ViewFolderInput } from '@/lib/api/endpoints/views';
import { AREA_FOLDER_MAX_LENGTH, areaFolderProblem, defaultAreaFolder } from '@/utils/areaFolder';
import { cn } from '@/lib/utils';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Creates an area or renames it, with its folder. The folder follows the name until it
// is edited; an area whose folder was set by hand keeps it on a rename.
export default function AreaDialog({
  title,
  description,
  submitLabel,
  area,
  areas,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  area?: ViewFolder;
  areas: ViewFolder[];
  onSubmit: (input: ViewFolderInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useTranslations('views');
  const tCommon = useTranslations('common');
  const nameId = useId();
  const folderId = useId();
  const taken = useMemo(
    () => new Set(areas.filter((other) => other.id !== area?.id).map((other) => other.folder)),
    [areas, area?.id],
  );
  const [name, setName] = useState(area?.name ?? '');
  const [folder, setFolder] = useState(area?.folder ?? '');
  const [follows, setFollows] = useState(
    !area || area.folder === defaultAreaFolder(area.name, taken),
  );
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const shown = follows ? (trimmed ? defaultAreaFolder(trimmed, taken) : '') : folder;
  const problem = shown ? areaFolderProblem(shown, taken) : null;
  const ready =
    trimmed !== '' &&
    shown !== '' &&
    !problem &&
    (trimmed !== area?.name || shown !== area?.folder);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await onSubmit({ name: trimmed, folder: shown });
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} description={description} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>{t('folderNamePrompt')}</Label>
          <Input
            id={nameId}
            autoFocus
            dir="auto"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={folderId}>{t('areaFolderLabel')}</Label>
          <Input
            id={folderId}
            dir="ltr"
            className="font-mono"
            value={shown}
            maxLength={AREA_FOLDER_MAX_LENGTH}
            aria-invalid={problem !== null}
            onChange={(event) => {
              setFolder(event.target.value);
              setFollows(false);
            }}
          />
          <p className={cn('text-xs', problem ? 'text-destructive' : 'text-muted-foreground')}>
            {problem === 'reserved'
              ? t('areaFolderReserved', { folder: shown })
              : problem === 'taken'
                ? t('areaFolderTaken')
                : t('areaFolderHint')}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={busy || !ready}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
