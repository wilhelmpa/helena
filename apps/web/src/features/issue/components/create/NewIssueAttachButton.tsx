import { useRef } from 'react';
import { Paperclip } from 'lucide-react';
import { useStorageSettingsQuery } from '@/services/storage.service';
import { attachmentAccept } from '@/utils/uploadLimits';
import { useUploadLimitText } from '@/hooks/useUploadLimitText';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslations } from 'next-intl';

// Attaches files to an issue being created; the picked files are listed by
// NewIssueAttachmentStrip and uploaded once the issue exists.
export default function NewIssueAttachButton({
  onPick,
}: {
  onPick: (files: FileList | null) => void;
}) {
  const t = useTranslations('issue.attachments');
  const limits = useStorageSettingsQuery().data;
  const uploadLimitText = useUploadLimitText();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('attachFiles')}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {t('attachFiles')}
          {limits && `. ${uploadLimitText.hint(limits)}`}
        </TooltipContent>
      </Tooltip>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={attachmentAccept(limits)}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}
