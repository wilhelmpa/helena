import { useTranslations } from 'next-intl';
import type { AgentNetworkEvent } from '@/lib/api/endpoints/agentNetwork';
import { byKey } from '@/utils/messageKey';
import { formatDateTime } from '@/utils/dates';
import { formatSize } from '@/utils/fileSize';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { Box, Text } from '@/design-system';

export default function SettingsNetworkLogRow({ event }: { event: AgentNetworkEvent }) {
  const t = useTranslations('settings.network');
  const relativeTime = useRelativeTime();
  const agentName = event.agent?.name || event.agent?.username;

  return (
    <TableRow>
      <TableCell className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{relativeTime(event.lastAt)}</span>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(event.lastAt)}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="px-3 py-2 text-sm">
        <div className="truncate font-medium">{agentName ?? '—'}</div>
        {event.runId != null && <div className="text-xs text-muted-foreground">#{event.runId}</div>}
      </TableCell>
      <TableCell className="px-3 py-2 font-mono text-xs">
        {event.host}:{event.port}
      </TableCell>
      <TableCell className="px-3 py-2">
        <Badge variant={event.decision === 'blocked' ? 'destructive' : 'secondary'}>
          {byKey(t)(`decisions.${event.decision}`)}
        </Badge>
        {event.decision === 'blocked' && event.reason && (
          <Box as="p" marginTop={1}>
            <Text as="span" size="xs" tone="muted">
              {byKey(t)(`reasons.${event.reason}`)}
            </Text>
          </Box>
        )}
      </TableCell>
      <TableCell className="px-3 py-2 text-end text-sm tabular-nums">{event.connections}</TableCell>
      <TableCell className="px-3 py-2 text-end text-xs text-muted-foreground tabular-nums">
        ↑ {formatSize(event.bytesOut)} / ↓ {formatSize(event.bytesIn)}
      </TableCell>
    </TableRow>
  );
}
