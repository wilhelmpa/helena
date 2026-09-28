'use client';

import { useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/design-system';
import type { LocalModel, ModelServer } from '@/lib/api/endpoints/localAi';
import { gib } from '../utils/localAi';
import { hasStartOptions } from '../utils/modelStartOptions';
import LocalModelStartOptions from './LocalModelStartOptions';

// A model of a model server: its name, unit, capabilities and size, whether it is loaded,
// and on a Lemonade server its start options, opened in place under the row.
export default function LocalModelRow({
  server,
  model,
}: {
  server: ModelServer;
  model: LocalModel;
}) {
  const t = useTranslations('localAi.servers');
  const tOptions = useTranslations('localAi.startOptions');
  const tUnits = useTranslations('localAi.units');
  const [open, setOpen] = useState(false);
  const lemonade = server.kind === 'lemonade';
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2">
      <span className="min-w-0 flex-1 truncate" dir="ltr">
        {model.name}
      </span>
      <span className="text-xs text-muted-foreground">
        {[model.unit ? tUnits(model.unit) : null, model.capabilities.join(', ')]
          .filter(Boolean)
          .join(' · ')}
        {model.sizeBytes ? ` · ${gib(model.sizeBytes)}` : ''}
      </span>
      {hasStartOptions(model.startOptions) && (
        <Badge variant="outline" className="text-xs">
          {tOptions('custom')}
        </Badge>
      )}
      {model.loaded ? (
        <Badge variant="secondary" className="text-xs">
          {t('loaded')}
        </Badge>
      ) : model.downloaded === false ? (
        <Badge variant="outline" className="text-xs">
          {t('notDownloaded')}
        </Badge>
      ) : null}
      {lemonade && (
        <Button
          variant="ghost"
          size="small"
          aria-expanded={open}
          icon={open ? <ChevronDown aria-hidden /> : <SlidersHorizontal aria-hidden />}
          onClick={() => setOpen(!open)}
        >
          {tOptions('title')}
        </Button>
      )}
      {lemonade && open && (
        <LocalModelStartOptions serverId={server.id} model={model} onDone={() => setOpen(false)} />
      )}
    </li>
  );
}
