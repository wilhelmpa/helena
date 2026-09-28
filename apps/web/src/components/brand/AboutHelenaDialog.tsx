'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import BrandHero from '@/components/brand/BrandHero';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { UPSTREAM_URL } from '@/utils/app';

// "Über Helena", opened from the account menu: the brand on Hermes' ink as on the
// sign-in panel (BrandHero), what Helena is, what it runs on, and the fork attribution
// the AGPL asks for (NOTICE, README and this dialog carry it). No version: the owner
// wants none shown.
export default function AboutHelenaDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('nav');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="small"
        className="gap-0 overflow-hidden p-0 [&>[data-slot=dialog-close]]:text-helena-ink-muted [&>[data-slot=dialog-close]]:hover:bg-white/10 [&>[data-slot=dialog-close]]:hover:text-helena-ink-foreground"
      >
        <BrandHero className="px-6 pt-10 pb-8" />
        <div className="flex flex-col gap-2 p-4">
          <DialogTitle>{t('about')}</DialogTitle>
          <DialogDescription className="text-sm text-foreground">
            {t('aboutTagline')}
          </DialogDescription>
          <p className="text-sm text-muted-foreground">{t('aboutRuntime')}</p>
          <a
            href={UPSTREAM_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('basedOn')}
            <ExternalLink className="size-3" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
