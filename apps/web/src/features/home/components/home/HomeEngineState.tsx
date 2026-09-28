import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { EngineHealth } from '@/lib/api/endpoints/god';
import { formatDurationShort } from '@/utils/dates';
import { workflowsPath } from '@/utils/paths';
import { useModelFailureText } from '@/features/model-availability/hooks/useModelFailureText';
import { Stack } from '@/design-system';

// What the Helena engine is doing, in one line under the services, and the newest runs
// that failed, each a link to the project's workflows.
export default function HomeEngineState({ engine }: { engine: EngineHealth }) {
  const t = useTranslations('god.systemHealth.engine');
  // A failure the runtime explained (a model the provider refused) in the reader's language.
  const explained = useModelFailureText();
  return (
    <Stack gap={1} marginTop={1} padX={2} className="text-xs text-muted-foreground">
      <p>
        {t('summary', {
          active: engine.active,
          waiting: engine.waiting,
          queued: engine.queued,
          schedules: engine.schedules,
        })}
      </p>
      {engine.lastErrors.slice(0, 3).map((failure) => (
        <p key={failure.runId} className="truncate" title={failure.error}>
          <Link
            href={workflowsPath(failure.projectKey)}
            className="text-destructive hover:underline"
          >
            {t('failure', {
              name: failure.name || failure.projectKey,
              time: failure.at ? formatDurationShort(failure.at) : '',
            })}
          </Link>{' '}
          {explained(failure.failure) ?? failure.error}
        </p>
      ))}
    </Stack>
  );
}
