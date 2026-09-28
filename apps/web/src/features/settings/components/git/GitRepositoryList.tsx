import { useTranslations } from 'next-intl';
import type { GitRepository } from '@/lib/api/endpoints/git';
import { useRelativeTime } from '@/context/relativeTimeContext';

import { Inline, Stack, Text } from '@/design-system';

// Every repository that has delivered to this project, newest first. The list
// makes an accidental connection visible: a repository nobody meant to connect
// shows up here as soon as it delivers.
export default function GitRepositoryList({ repositories }: { repositories: GitRepository[] }) {
  const t = useTranslations('settings.git');
  const relativeTime = useRelativeTime();

  return (
    <Stack gap={3} pad={4}>
      {repositories.length === 0 && (
        <Text as="p" size="xs" tone="muted">
          {t('noDelivery')}
        </Text>
      )}
      <Stack as="ul" gap={2}>
        {repositories.map((r) => (
          <Inline
            as="li"
            gap={4}
            align="baseline"
            justify="between"
            key={`${r.provider}/${r.repo}`}
            className="flex items-baseline justify-between"
          >
            <Text as="span" size="xs" dir="ltr" className="font-mono">
              {r.repo}
            </Text>
            <Text as="span" size="xs" tone="muted" className="whitespace-nowrap">
              {t('repositoryMeta', {
                provider: r.provider,
                ago: relativeTime(r.lastEventAt),
              })}
            </Text>
          </Inline>
        ))}
      </Stack>
    </Stack>
  );
}
