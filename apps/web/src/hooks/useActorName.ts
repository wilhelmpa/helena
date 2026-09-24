import { useTranslations } from 'next-intl';

// The names the API stores for changes no person made (activity.ts `{ system: … }`):
// data written in English, worded here in the reader's language. Any other name is a
// person's or an agent's and stays as it is.
const SYSTEM_ACTORS = {
  Workflow: 'workflow',
  'Agent team': 'agentTeam',
  'Auto-archive': 'autoArchive',
} as const;

// The actor of an activity or a notification as the reader sees it; `fallback` when
// the event carries no name at all.
export function useActorName() {
  const t = useTranslations('common.systemActors');
  return (name: string | null | undefined, fallback: string): string => {
    if (!name) return fallback;
    const key = SYSTEM_ACTORS[name as keyof typeof SYSTEM_ACTORS];
    return key ? t(key) : name;
  };
}
