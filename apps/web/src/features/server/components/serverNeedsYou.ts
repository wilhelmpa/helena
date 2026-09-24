'use client';

import { Server } from 'lucide-react';
import type { NeedsYouEntry, NeedsYouSourceResult } from '@/extensions/needsYouSources';
import { serverPath } from '@/utils/paths';
import { useServerOverview } from '../services/server.service';
import { redServerItems, serverHealthItems, serverTabOf } from '../utils/serverHome';
import { useHealthMessage } from './ServerParts';

// "Braucht dich" ← the machine (extensions/needsYouSources): every red line of Administrator →
// Server (a degraded mirror, a failing disk, a failed backup, check or restore test, a CPU
// too hot) and the thermal guard, each opening its tab. For the Administrator; nothing on a
// host without the host helper.
export function useServerEntries({ owner }: { owner: boolean }): NeedsYouSourceResult {
  const overview = useServerOverview(owner);
  const message = useHealthMessage();
  if (!owner) return { entries: [], isPending: false };
  const entries = redServerItems(serverHealthItems(overview.data)).map((item): NeedsYouEntry => ({
    key: `problem:server:${item.id}`,
    kind: 'problem',
    at: item.since ?? '',
    href: serverPath(serverTabOf(item.id)),
    icon: Server,
    title: message(item).replace(/\.$/, ''),
    detail: '',
  }));
  return { entries, isPending: false };
}
