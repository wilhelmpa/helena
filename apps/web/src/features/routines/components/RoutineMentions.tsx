import { AtSign, Check, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { RoutineMention } from '@/lib/api/endpoints/routines';
import { cn } from '@/lib/utils';
import { useRoutineMentionsPreview } from '../services/routines.service';
import { Stack, Text } from '@/design-system';

// The agents a routine's instructions @mention besides its own agent. Every run starts
// each of them on the routine's task, as a mention of the member the routine acts for;
// one that it will not start says why.

// The reason a mention starts nobody, in the reader's language.
export function useMentionReason() {
  const t = useTranslations('routines.mentionReason');
  return (mention: RoutineMention) => (mention.reason ? t(mention.reason) : '');
}

export function RoutineMentionList({ mentions }: { mentions: RoutineMention[] }) {
  const t = useTranslations('routines');
  const reason = useMentionReason();
  return (
    <Stack gap={1}>
      <Text as="p" size="xs" tone="muted">
        {t('mentionsTitle')}
      </Text>
      <Stack as="ul" gap={1}>
        {mentions.map((mention) => (
          <li
            key={mention.agent.id}
            className={cn(
              'flex min-w-0 items-start gap-1.5 text-xs',
              mention.starts ? 'text-muted-foreground' : 'text-destructive',
            )}
          >
            {mention.starts ? (
              <Check className="mt-px size-3.5 shrink-0" />
            ) : (
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
            )}
            <span className="min-w-0">
              <span className="font-medium text-foreground" dir="auto">
                {mention.agent.name}
              </span>{' '}
              <span dir="ltr">@{mention.agent.username}</span>
              {' · '}
              {mention.starts ? t('mentionStarts') : reason(mention)}
            </span>
          </li>
        ))}
      </Stack>
    </Stack>
  );
}

// Under the instructions while they are written: what a run of the routine would start,
// for the member writing them.
export function RoutineMentionsPreview({
  projectKey,
  instructions,
  agentId,
}: {
  projectKey: string;
  instructions: string;
  agentId: number | null;
}) {
  const preview = useRoutineMentionsPreview(projectKey, instructions, agentId);
  if (!instructions.includes('@') || !preview.data || preview.data.length === 0) return null;
  return <RoutineMentionList mentions={preview.data} />;
}

// One line of a routine in the list: the agents it starts besides its own, and how many
// of its mentions start nobody.
export function RoutineMentionsLine({
  mentions,
  className = 'mt-0.5',
}: {
  mentions: RoutineMention[];
  className?: string;
}) {
  const t = useTranslations('routines');
  const reason = useMentionReason();
  if (mentions.length === 0) return null;
  const started = mentions.filter((mention) => mention.starts);
  const refused = mentions.filter((mention) => !mention.starts);
  return (
    <>
      {started.length > 0 && (
        <p
          className={cn('flex min-w-0 items-center gap-1 text-xs text-muted-foreground', className)}
          title={started.map((mention) => `@${mention.agent.username}`).join(', ')}
        >
          <AtSign className="size-3.5 shrink-0" />
          <span className="truncate" dir="auto">
            {t('mentionsStart', {
              names: started.map((mention) => mention.agent.name).join(', '),
            })}
          </span>
        </p>
      )}
      {refused.length > 0 && (
        <p
          className={cn('flex min-w-0 items-center gap-1 text-xs text-destructive', className)}
          title={refused
            .map((mention) => `@${mention.agent.username}: ${reason(mention)}`)
            .join('\n')}
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="truncate">{t('mentionsRefused', { count: refused.length })}</span>
        </p>
      )}
    </>
  );
}
