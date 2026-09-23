import { useTranslations } from 'next-intl';
import FilePickerDialog from '@/components/common/files/FilePickerDialog';
import type { Attachment } from '@/lib/api/endpoints/attachments';
import { useRelinkAttachment } from '../../services/attachments.service';

// Picks the file of the project folder a missing attachment is pointed at.
export default function IssueAttachmentRelinkDialog({
  issueId,
  projectKey,
  attachment,
  onClose,
}: {
  issueId: number;
  projectKey: string;
  attachment: Attachment;
  onClose: () => void;
}) {
  const t = useTranslations('files');
  const relink = useRelinkAttachment(issueId);
  return (
    <FilePickerDialog
      scope={{ kind: 'project', projectKey, root: 'vault' }}
      mode="file"
      title={t('attachment.relinkTitle', { name: attachment.filename })}
      confirmLabel={t('picker.choose')}
      onPick={(path) => relink.mutate({ publicId: attachment.id, path }, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}
