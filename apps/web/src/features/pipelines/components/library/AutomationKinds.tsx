'use client';

import { CalendarClock, HeartPulse, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ButtonLink, Card, Grid, Inline, Text } from '@/design-system';

// What is what in Automatisierung (owner, O25: workflows were not understandable, and how
// they differ from schedules and routines): three cards, one sentence each, with the way
// to the page of the other two.
export default function AutomationKinds() {
  const t = useTranslations('pipelines.kindsOverview');
  const kinds = [
    { id: 'workflow', icon: Workflow, href: null },
    { id: 'schedule', icon: CalendarClock, href: '/schedules' },
    { id: 'heartbeat', icon: HeartPulse, href: '/organization' },
  ] as const;
  return (
    <Grid columns={3} gap={3}>
      {kinds.map(({ id, icon: Icon, href }) => (
        <Card
          key={id}
          title={
            <Inline gap={2}>
              <Icon size={15} aria-hidden="true" />
              {t(`${id}.title`)}
            </Inline>
          }
        >
          <Text size="sm" tone="muted">
            {t(`${id}.text`)}
          </Text>
          {href && (
            <Inline>
              <ButtonLink href={href} size="small">
                {t(`${id}.open`)}
              </ButtonLink>
            </Inline>
          )}
        </Card>
      ))}
    </Grid>
  );
}
