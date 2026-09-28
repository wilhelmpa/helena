'use client';

import { useState } from 'react';
import { AppWindow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import ProjectPreviewList from './ProjectPreviewList';

export default function ProjectPreviewControl({
  projectKey,
  onOpen,
}: {
  projectKey: string;
  onOpen: (url: string) => void;
}) {
  const t = useTranslations('nav.workspace.browserPreviews');
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          title={t('title')}
          aria-label={t('title')}
        >
          <AppWindow />
        </Button>
      </DialogTrigger>
      <DialogContent
        size="large"
        className="max-h-[85dvh] overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {t('title')} · {projectKey}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <ProjectPreviewList
            projectKey={projectKey}
            onOpen={(url) => {
              onOpen(url);
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
