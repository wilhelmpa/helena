'use client';

import { useTranslations } from 'next-intl';
import { Inline, PillButton, Stack, Text } from '@/design-system';
import { usePaperConnections } from '../../hooks/useTradingWidgets';

// Which paper account a trading dashboard reads (Werkzeuge → Alpaca Paper): the team's
// paper connections as a row of choices. Only paper connections exist here; the API refuses
// any other. The choice changes what is shown, never the account itself.
export default function TradingConnectionChoice({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (id: number) => void;
}) {
  const t = useTranslations('dashboards.trading.widgets.connection');
  const { connections, loading } = usePaperConnections();
  if (loading) return <Text tone="faint">{t('loading')}</Text>;
  if (connections.length === 0) return <Text tone="muted">{t('none')}</Text>;
  return (
    <Stack gap={2}>
      <Text tone="muted" size="xs">
        {t('label')}
      </Text>
      <Inline gap={2} wrap role="radiogroup" aria-label={t('label')}>
        {connections.map((connection) => (
          <PillButton
            key={connection.id}
            role="radio"
            aria-checked={connection.id === value}
            tone={connection.id === value ? 'active' : 'neutral'}
            onClick={() => onChange(connection.id)}
          >
            {connection.label}
          </PillButton>
        ))}
      </Inline>
    </Stack>
  );
}
