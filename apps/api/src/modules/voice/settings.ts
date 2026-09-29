import { asc, eq } from 'drizzle-orm';
import { agentChatCatalog, aiAgent, db, getSetting, project, setSetting, user } from '@repo/db';
import type { PronunciationEntry } from './tts-text';

// The owner's voice settings (Lokale KI → Sprache; docs/helena-decisions/voice-2.md §5): one
// app_setting row. What the browser needs (the pause, the voice's speed) comes with `GET
// /voice`; the rest stays on the server:
//
// - pauseMs     how long a pause ends a conversation turn (the ear in the browser);
// - vocabulary  extra words the transcription should know (names, products, terms). Helena adds
//               the names of the agents and projects itself;
// - voice       the local voice (a name the speech server knows); null: the server's default;
// - speed       how fast the local voice speaks;
// - replyModel  the model (and reasoning) an agent answers spoken turns with; null: the one it
//               answers typed messages with.

export const VOICE_SETTINGS_KEY = 'voice.settings';
export const VOICE_GLOSSARY = ['Helena', 'TRADE', 'VERVE', 'Jev', 'Qwen', 'Alpaca'] as const;

export interface VocabularyAlias {
  heard: string;
  written: string;
}

export interface VoiceSettings {
  pauseMs: number;
  vocabulary: string[];
  vocabularyAliases: VocabularyAlias[] | null;
  voice: string | null;
  speed: number;
  pronunciationLexicon: PronunciationEntry[];
  replyModel: string | null;
  replyThinkingLevel: string | null;
}

export const VOICE_SETTINGS_LIMITS = {
  pauseMs: { min: 300, max: 2000 },
  speed: { min: 0.7, max: 1.4 },
  // Whisper reads at most 224 tokens of prompt; the rest would be cut anyway.
  vocabularyWords: 60,
  vocabularyWordLength: 60,
  vocabularyAliases: 60,
  pronunciationLexicon: 100,
} as const;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  pauseMs: 600,
  vocabulary: [],
  vocabularyAliases: null,
  voice: null,
  speed: 1,
  pronunciationLexicon: [],
  replyModel: null,
  replyThinkingLevel: null,
};

function clamp(value: unknown, { min, max }: { min: number; max: number }, fallback: number) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function word(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, VOICE_SETTINGS_LIMITS.vocabularyWordLength) : null;
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function uniqueWords(words: Iterable<string>, limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const clean = word(raw);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeAliases(raw: unknown): VocabularyAlias[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const aliases: VocabularyAlias[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const heard = word(entry.heard);
    const written = word(entry.written);
    if (!heard || !written || heard === written) continue;
    const key = heard.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push({ heard, written });
    if (aliases.length >= VOICE_SETTINGS_LIMITS.vocabularyAliases) break;
  }
  return aliases;
}

function normalizePronunciations(raw: unknown): PronunciationEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: PronunciationEntry[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const wordValue = word(item.word);
    const pronunciation = word(item.pronunciation);
    if (!wordValue || !pronunciation || /[\n\r<>]/.test(wordValue + pronunciation)) continue;
    const key = wordValue.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ word: wordValue, pronunciation });
    if (entries.length >= VOICE_SETTINGS_LIMITS.pronunciationLexicon) break;
  }
  return entries;
}

export function normalizeVoiceSettings(raw: unknown): VoiceSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const defaults = DEFAULT_VOICE_SETTINGS;
  return {
    pauseMs: Math.round(clamp(value.pauseMs, VOICE_SETTINGS_LIMITS.pauseMs, defaults.pauseMs)),
    vocabulary: uniqueWords(
      Array.isArray(value.vocabulary) ? (value.vocabulary as unknown[]).map(String) : [],
      VOICE_SETTINGS_LIMITS.vocabularyWords,
    ),
    vocabularyAliases: normalizeAliases(value.vocabularyAliases),
    voice: optionalText(value.voice, 120),
    speed: Math.round(clamp(value.speed, VOICE_SETTINGS_LIMITS.speed, defaults.speed) * 100) / 100,
    pronunciationLexicon: normalizePronunciations(value.pronunciationLexicon),
    replyModel: optionalText(value.replyModel, 200),
    replyThinkingLevel: value.replyModel ? optionalText(value.replyThinkingLevel, 40) : null,
  };
}

export function suggestedAliases(names: string[]): VocabularyAlias[] {
  const known = new Set(names);
  return [
    ...(known.has('Jev') ? [{ heard: 'Jeff', written: 'Jev' }] : []),
    ...(known.has('VERVE')
      ? ['Färfe', 'Ferfe', 'Verve'].map((heard) => ({ heard, written: 'VERVE' }))
      : []),
    ...(known.has('TRADE') ? [{ heard: 'Trade', written: 'TRADE' }] : []),
  ];
}

export function correctVocabulary(text: string, aliases: VocabularyAlias[]): string {
  if (!aliases.length) return text;
  const replacements = new Map(
    aliases.map(({ heard, written }) => [heard.toLocaleLowerCase('de-DE'), written]),
  );
  const escaped = [...replacements.keys()]
    .sort((a, b) => b.length - a.length)
    .map((heard) => heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  );
  return text.replace(
    pattern,
    (heard) => replacements.get(heard.toLocaleLowerCase('de-DE')) ?? heard,
  );
}

export async function readVoiceSettings(): Promise<VoiceSettings> {
  return normalizeVoiceSettings(await getSetting(VOICE_SETTINGS_KEY));
}

export async function writeVoiceSettings(patch: Partial<VoiceSettings>): Promise<VoiceSettings> {
  const next = normalizeVoiceSettings({ ...(await readVoiceSettings()), ...patch });
  await setSetting(VOICE_SETTINGS_KEY, next);
  return next;
}

// ── The words the transcription should know ──────────────────────────────────────────────

// The names people say to Helena: its own, the agents' and the projects' (with their keys, "VOL",
// "VERVE"). Whisper takes them as the context of the recording (its `prompt`), which is what
// makes "Verve" come back as "Verve" rather than "Werbe".
export async function helenaWords(): Promise<string[]> {
  const [agents, projects] = await Promise.all([
    db
      .select({ name: user.name })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .where(eq(aiAgent.template, false))
      .orderBy(asc(aiAgent.id)),
    db.select({ name: project.name, key: project.key }).from(project).orderBy(asc(project.id)),
  ]);
  return uniqueWords(
    [
      'Helena',
      ...agents.map((agent) => agent.name),
      ...projects.flatMap((row) => [row.name, row.key]),
    ],
    VOICE_SETTINGS_LIMITS.vocabularyWords,
  );
}

// The prompt a transcription gets: the owner's words first (they are what he added on purpose),
// then Helena's. A comma list reads to Whisper like the start of a text that uses the words.
export function vocabularyPrompt(own: string[], helena: string[]): string | null {
  const words = uniqueWords(
    [...own, ...VOICE_GLOSSARY, ...helena],
    VOICE_SETTINGS_LIMITS.vocabularyWords,
  );
  return words.length ? `${words.join(', ')}.` : null;
}

// ── The models spoken turns may be answered with ─────────────────────────────────────────

export interface ReplyModelChoice {
  id: string;
  name: string;
  thinkingLevels: string[];
}

// The models the agents' runtimes offer (their published chat catalogs), each once: the
// choices for "Modell für Gespräche". An agent whose runtime does not offer the chosen one
// answers spoken turns with its usual model (agents/chat/service.ts spokenModel).
export async function replyModelChoices(): Promise<ReplyModelChoice[]> {
  const rows = await db.select({ models: agentChatCatalog.models }).from(agentChatCatalog);
  const byId = new Map<string, ReplyModelChoice>();
  for (const row of rows) {
    const models = Array.isArray(row.models) ? (row.models as Record<string, unknown>[]) : [];
    for (const model of models) {
      const id = typeof model.id === 'string' ? model.id : null;
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        name: typeof model.name === 'string' && model.name ? model.name : id,
        thinkingLevels: Array.isArray(model.thinkingLevels)
          ? (model.thinkingLevels as unknown[]).filter(
              (level): level is string => typeof level === 'string',
            )
          : [],
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
