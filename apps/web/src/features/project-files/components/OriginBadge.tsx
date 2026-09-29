import { Bot, Cog, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Pill } from '@/design-system';
import type { FileOrigin } from '@/lib/api/endpoints/projectFiles';

// Where a file came from (UI findings G, O51): Helena itself, an agent, or a person. Lists
// mark only system and agent files; a file someone put there is the normal case.
export default function OriginBadge({ origin }: { origin: FileOrigin }) {
  const t = useTranslations('files.origin');
  const Icon = origin === 'agent' ? Bot : origin === 'system' ? Cog : User;
  return (
    <Pill
      tone={origin === 'agent' ? 'accent' : 'neutral'}
      icon={<Icon size={12} aria-hidden="true" />}
      data-origin={origin}
      title={t(`${origin}Hint`)}
    >
      {t(origin)}
    </Pill>
  );
}
