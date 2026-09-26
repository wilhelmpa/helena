'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ProjectPreviewStart } from '@/lib/api/endpoints/project-previews';

export default function ProjectPreviewForm({
  busy,
  onStart,
}: {
  busy: boolean;
  onStart: (body: ProjectPreviewStart) => void;
}) {
  const t = useTranslations('nav.workspace.browserPreviews');
  const [name, setName] = useState('main');
  const [cwd, setCwd] = useState('');
  return (
    <form
      className="space-y-2 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        onStart({ name: name.trim(), ...(cwd.trim() ? { cwd: cwd.trim() } : {}) });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          {t('name')}
          <Input
            dir="ltr"
            value={name}
            onChange={(event) => setName(event.target.value)}
            pattern="[a-z0-9][a-z0-9-]{0,39}"
            maxLength={40}
            required
            disabled={busy}
          />
        </label>
        <label className="space-y-1 text-xs">
          {t('directory')}
          <Input
            dir="ltr"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            placeholder={t('detect')}
            maxLength={512}
            disabled={busy}
          />
        </label>
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={busy || !name.trim()}>
        <Play />
        {t('start')}
      </Button>
    </form>
  );
}
