'use client';

import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslations } from 'next-intl';
import { copyText } from '@/utils/clipboard';

export default function DocumentCopyLinkButton() {
  const t = useTranslations('documents');

  const copy = async () => {
    await copyText(window.location.href);
    toast.success(t('linkCopied'));
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('copyLink')}
          onClick={() => void copy()}
        >
          <Link2 />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('copyLink')}</TooltipContent>
    </Tooltip>
  );
}
