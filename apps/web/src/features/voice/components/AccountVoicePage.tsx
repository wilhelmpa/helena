'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { VoiceSettings, VocabularyAlias } from '@/lib/api/endpoints/voice';
import { useUpdateVoiceSettings, useVoiceSettings } from '../hooks/useVoiceSettings';

function Editor({ settings }: { settings: VoiceSettings }) {
  const t = useTranslations('localAi.voice');
  const update = useUpdateVoiceSettings();
  const [words, setWords] = useState(settings.vocabulary.join('\n'));
  const [aliases, setAliases] = useState(
    (settings.vocabularyAliases ?? settings.suggestedAliases)
      .map(({ heard, written }) => `${heard} → ${written}`)
      .join('\n'),
  );
  const parsedWords = words
    .split(/[\n,]/)
    .map((word) => word.trim())
    .filter(Boolean);
  const lines = aliases
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const parsedAliases: VocabularyAlias[] = [];
  let valid = true;
  for (const line of lines) {
    const parts = line.split(/\s*(?:→|=>)\s*/);
    if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) valid = false;
    else parsedAliases.push({ heard: parts[0].trim(), written: parts[1].trim() });
  }
  const savedAliases = settings.vocabularyAliases ?? settings.suggestedAliases;
  const changed =
    parsedWords.join('\n') !== settings.vocabulary.join('\n') ||
    JSON.stringify(parsedAliases) !== JSON.stringify(savedAliases);
  const save = (vocabularyAliases: VocabularyAlias[] | null) =>
    update.mutate(
      { vocabulary: parsedWords, vocabularyAliases },
      { onError: (error: Error) => toast.error(error.message) },
    );

  return (
    <SettingsCard className="divide-y">
      <div className="space-y-2 p-4">
        <label htmlFor="voice-vocabulary" className="text-sm font-medium">
          {t('words.title')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('words.hint', { words: settings.helenaWords.slice(0, 12).join(', ') })}
        </p>
        <Textarea
          id="voice-vocabulary"
          value={words}
          onChange={(event) => setWords(event.target.value)}
          rows={3}
          placeholder={t('words.placeholder')}
        />
      </div>
      <div className="space-y-2 p-4">
        <label htmlFor="voice-aliases" className="text-sm font-medium">
          {t('aliases.title')}
        </label>
        <p className="text-xs text-muted-foreground">{t('aliases.hint')}</p>
        <Textarea
          id="voice-aliases"
          value={aliases}
          onChange={(event) => setAliases(event.target.value)}
          rows={5}
          placeholder={t('aliases.placeholder')}
        />
        {!valid && <p className="text-xs text-destructive">{t('aliases.invalid')}</p>}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={update.isPending}
            onClick={() => save(null)}
          >
            {t('aliases.reset')}
          </Button>
          <Button
            size="sm"
            disabled={!changed || !valid || update.isPending}
            onClick={() => save(parsedAliases)}
          >
            {t('aliases.save')}
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}

export default function AccountVoicePage() {
  const t = useTranslations('localAi.voice');
  const settings = useVoiceSettings();
  return (
    <SectionPageView title={t('title')}>
      {settings.data ? (
        <Editor
          key={JSON.stringify([
            settings.data.vocabulary,
            settings.data.vocabularyAliases,
            settings.data.suggestedAliases,
          ])}
          settings={settings.data}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {settings.isError ? t('failed') : t('loading')}
        </p>
      )}
    </SectionPageView>
  );
}
