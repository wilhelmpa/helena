import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import IssuePickerDialog from '@/components/common/overlay/IssuePickerDialog';
import { linkAttachment } from '@/lib/api/endpoints/attachments';
import type { IssueSearchHit } from '@/lib/api/endpoints/issues';

// Attaches a file of the project folder to a task without copying it.
export default function FileLinkTaskDialog({
  projectKey,
  path,
  onClose,
}: {
  projectKey: string;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations('files.linkDialog');
  const link = useMutation({
    mutationFn: (hit: IssueSearchHit) => linkAttachment(hit.id, path),
    onSuccess: (_attachment, hit) => {
      toast.success(t('linked', { identifier: hit.identifier }));
      onClose();
    },
  });

  return (
    <IssuePickerDialog
      projectKey={projectKey}
      title={t('title')}
      prompt={t('prompt')}
      onPick={(hit) => link.mutate(hit)}
      onClose={onClose}
    />
  );
}
