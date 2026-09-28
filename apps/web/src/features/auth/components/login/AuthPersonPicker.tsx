import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { UserPlus, UserRound } from 'lucide-react';
import { Button, List, ListRow, MonoLabel } from '@/design-system';
import {
  parsePeople,
  readPeople,
  serverPeople,
  subscribePeople,
  forgetPeople,
} from '@/utils/rememberedPeople';

// "Wer meldet sich an?" on a device several people share: the names remembered on this
// browser as one design-system list (docs/design-system.md §4). Choosing one only fills
// the identifier; every person still signs in with their own password or passkey.
export default function AuthPersonPicker({ onSelect }: { onSelect: (identifier: string) => void }) {
  const t = useTranslations('auth.login');
  const people = parsePeople(useSyncExternalStore(subscribePeople, readPeople, serverPeople));
  if (people.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={t('personTitle')}>
      <MonoLabel>{t('personTitle')}</MonoLabel>
      <List label={t('personTitle')}>
        {people.map((person) => (
          <ListRow
            key={person.email}
            icon={<UserRound />}
            title={person.name || person.email}
            subtitle={person.name ? person.email : undefined}
            onSelect={() => onSelect(person.email)}
          />
        ))}
        <ListRow icon={<UserPlus />} title={t('otherPerson')} onSelect={() => onSelect('')} />
      </List>
      <p className="text-xs text-muted-foreground">{t('personHelp')}</p>
      <div>
        <Button variant="ghost" size="small" onClick={forgetPeople}>
          {t('forgetPeople')}
        </Button>
      </div>
    </section>
  );
}
