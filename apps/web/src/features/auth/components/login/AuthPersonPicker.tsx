import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  parsePeople,
  readPeople,
  serverPeople,
  subscribePeople,
  forgetPeople,
} from '@/utils/rememberedPeople';

export default function AuthPersonPicker({ onSelect }: { onSelect: (identifier: string) => void }) {
  const t = useTranslations('auth.login');
  const people = parsePeople(useSyncExternalStore(subscribePeople, readPeople, serverPeople));
  return (
    <section className="space-y-2" aria-label={t('personTitle')}>
      <p className="text-sm text-muted-foreground">{t('personHelp')}</p>
      {people.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {people.map((person) => (
              <Button
                key={person.email}
                type="button"
                variant="outline"
                onClick={() => onSelect(person.email)}
              >
                {person.name || person.email}
              </Button>
            ))}
            <Button type="button" variant="outline" onClick={() => onSelect('')}>
              {t('otherPerson')}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={forgetPeople}>
            {t('forgetPeople')}
          </Button>
        </>
      )}
    </section>
  );
}
