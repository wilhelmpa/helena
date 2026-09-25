'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { VoiceSettings, VoiceSettingsPatch } from '@/lib/api/endpoints/voice';
import { speak } from '../browser/speak';
import { createLocalSpeaker } from '../browser/speakers';
import { useVoiceSettings, useUpdateVoiceSettings } from '../hooks/useVoiceSettings';
import { useVoiceStatus } from '../hooks/useVoice';

// Lokale KI → Sprache (docs/helena-decisions/voice-2.md §5): the owner's voice settings — how
// long a pause ends a turn, the words the transcription should know, the local voice, and the
// model agents answer spoken turns with. Each change is saved at once (the words with their
// button) and applies from the next turn.

const PAUSES = [400, 600, 900, 1300] as const;
const SPEEDS = [0.85, 1, 1.1, 1.2] as const;
const DEFAULT = '__default__';

function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:w-72">{children}</div>
    </div>
  );
}

// The owner's own words, comma separated or one per line, saved with the button.
function WordsRow({
  settings,
  saving,
  onSave,
}: {
  settings: VoiceSettings;
  saving: boolean;
  onSave: (vocabulary: string[]) => void;
}) {
  const t = useTranslations('localAi.voice');
  const [words, setWords] = useState(settings.vocabulary.join(', '));
  const typed = words
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter(Boolean);
  const changed = typed.join('\n') !== settings.vocabulary.join('\n');
  return (
    <Row
      title={t('words.title')}
      hint={t('words.hint', { words: settings.helenaWords.slice(0, 12).join(', ') })}
    >
      <Textarea
        value={words}
        onChange={(event) => setWords(event.target.value)}
        rows={3}
        placeholder={t('words.placeholder')}
        aria-label={t('words.title')}
        className="text-[13px]"
      />
      <Button
        variant="outline"
        size="sm"
        className="self-end"
        disabled={!changed || saving}
        onClick={() => onSave(typed)}
      >
        {t('words.save')}
      </Button>
    </Row>
  );
}

// Plays a sample sentence in the voice the conversation would use now: Helena's local voice
// (Lokale KI → Vorlesen) where it runs, otherwise the browser's.
function PreviewButton() {
  const t = useTranslations('localAi.voice');
  const status = useVoiceStatus();
  const [playing, setPlaying] = useState(false);
  const play = () => {
    const sample = t('voice.sample');
    setPlaying(true);
    if (!status.data?.speech.local) {
      if (!speak(sample, () => setPlaying(false))) setPlaying(false);
      return;
    }
    const speaker = createLocalSpeaker({
      onStart: () => {},
      onIdle: () => {
        setPlaying(false);
        speaker.destroy();
      },
      onError: () => toast.error(t('voice.previewFailed')),
    });
    speaker.unlock();
    speaker.enqueue(sample);
  };
  return (
    <Button variant="outline" size="sm" className="self-end" disabled={playing} onClick={play}>
      {t('voice.preview')}
    </Button>
  );
}

export default function VoiceSettingsSection() {
  const t = useTranslations('localAi.voice');
  const settings = useVoiceSettings();
  const data = settings.data;
  return (
    <SettingsSection title={t('title')}>
      <SettingsCard className="divide-y">
        {data ? (
          <VoiceSettingsRows settings={data} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {settings.isError ? t('failed') : t('loading')}
          </p>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function VoiceSettingsRows({ settings }: { settings: VoiceSettings }) {
  const t = useTranslations('localAi.voice');
  const update = useUpdateVoiceSettings();
  const save = (patch: VoiceSettingsPatch) =>
    update.mutate(patch, { onError: (error: Error) => toast.error(error.message) });

  const pause = String(settings.pauseMs);
  const pauses: number[] = PAUSES.includes(settings.pauseMs as (typeof PAUSES)[number])
    ? [...PAUSES]
    : [...PAUSES, settings.pauseMs].sort((a, b) => a - b);
  const model = settings.replyModels.find((entry) => entry.id === settings.replyModel);

  return (
    <>
      <Row title={t('pause.title')} hint={t('pause.hint')}>
        <Select value={pause} onValueChange={(value) => save({ pauseMs: Number(value) })}>
          <SelectTrigger className="w-full" aria-label={t('pause.title')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pauses.map((ms) => (
              <SelectItem key={ms} value={String(ms)}>
                {t('pause.option', { seconds: ms / 1000 })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <WordsRow
        // A saved list starts the field over (a remount, not an effect).
        key={settings.vocabulary.join('\n')}
        settings={settings}
        saving={update.isPending}
        onSave={(vocabulary) => save({ vocabulary })}
      />

      <Row title={t('voice.title')} hint={t('voice.hint')}>
        <Select
          value={settings.voice ?? DEFAULT}
          onValueChange={(value) => save({ voice: value === DEFAULT ? null : value })}
          disabled={settings.voices.length === 0 && !settings.voice}
        >
          <SelectTrigger className="w-full" aria-label={t('voice.title')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>{t('voice.default')}</SelectItem>
            {[...new Set([...(settings.voice ? [settings.voice] : []), ...settings.voices])].map(
              (name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        {settings.voices.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('voice.none')}</p>
        )}
        <PreviewButton />
      </Row>

      <Row title={t('speed.title')} hint={t('speed.hint')}>
        <Select value={String(settings.speed)} onValueChange={(value) => save({ speed: Number(value) })}>
          <SelectTrigger className="w-full" aria-label={t('speed.title')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([...SPEEDS, settings.speed])]
              .sort((a, b) => a - b)
              .map((speed) => (
                <SelectItem key={speed} value={String(speed)}>
                  {t('speed.option', { speed: Math.round(speed * 100) })}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Row>

      <Row title={t('model.title')} hint={t('model.hint')}>
        <Select
          value={settings.replyModel ?? DEFAULT}
          onValueChange={(value) =>
            save(
              value === DEFAULT
                ? { replyModel: null, replyThinkingLevel: null }
                : { replyModel: value, replyThinkingLevel: null },
            )
          }
        >
          <SelectTrigger className="w-full" aria-label={t('model.title')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>{t('model.default')}</SelectItem>
            {settings.replyModels.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {model && model.thinkingLevels.length > 0 && (
          <Select
            value={settings.replyThinkingLevel ?? DEFAULT}
            onValueChange={(value) => save({ replyThinkingLevel: value === DEFAULT ? null : value })}
          >
            <SelectTrigger className="w-full" aria-label={t('model.thinking')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t('model.thinkingDefault')}</SelectItem>
              {model.thinkingLevels.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Row>
    </>
  );
}
