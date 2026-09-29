import { useTranslations } from 'next-intl';
import type { AgentNetworkEvent } from '@/lib/api/endpoints/agentNetwork';
import { byKey } from '@/utils/messageKey';
import { formatDateTime } from '@/utils/dates';
import { formatSize } from '@/utils/fileSize';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { Box, Text, Td, Tr } from '@/design-system';

export default function SettingsNetworkLogRow({ event }: { event: AgentNetworkEvent }) {
  const t = useTranslations('settings.network');
  const relativeTime = useRelativeTime();
  const agentName = event.agent?.name || event.agent?.username;

  return (
    <Tr>
      <Td>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{relativeTime(event.lastAt)}</span>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(event.lastAt)}</TooltipContent>
        </Tooltip>
      </Td>
      <Td>
        <div className="truncate font-medium">{agentName ?? '—'}</div>
        {event.runId != null && <div className="text-xs text-muted-foreground">#{event.runId}</div>}
      </Td>
      <Td className="font-mono">
        {event.host}:{event.port}
      </Td>
      <Td>
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
      </Td>
      <Td alignment="end" className="tabular-nums">
        {event.connections}
      </Td>
      <Td alignment="end" className="tabular-nums">
        ↑ {formatSize(event.bytesOut)} / ↓ {formatSize(event.bytesIn)}
      </Td>
    </Tr>
  );
}
