// Model ids are for machines; the matrix names them the way people say them ("Flash
// (lokal)", "GPT-6 Sol", "Claude Opus 5.5"). The catalog of the agents' model picker wins
// where it has a name; the rest is worded from the id, never shown as `helena-halogen/…`.
const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function prettyModelId(id: string): string {
  const bare = id.replace(/^helena-[a-z0-9-]+\//, '');
  const gpt = /^gpt-(\d+(?:\.\d+)?)-([a-z]+)/i.exec(bare);
  if (gpt) return `GPT-${gpt[1]} ${cap(gpt[2]!)}`;
  const claude = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/i.exec(bare);
  if (claude)
    return `Claude ${cap(claude[1]!.toLowerCase())} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  if (/flash/i.test(bare)) return 'Flash';
  const qwen = /^(?:halogen-)?qwen[-\s]?(\d+(?:\.\d+)?)(?:[-\s]?(\d+b))?/i.exec(bare);
  if (qwen) return `Qwen${qwen[1]}${qwen[2] ? ` ${qwen[2].toUpperCase()}` : ''}`;
  return bare.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isLocalId(id: string): boolean {
  return id === 'volition-local-default' || /^helena-[a-z0-9-]+\//.test(id);
}

export function modelLabel(
  id: string,
  words: { localDefault: string; local: string },
  names?: ReadonlyMap<string, string>,
): string {
  if (id === 'volition-local-default') return words.localDefault;
  const named = names?.get(id);
  const label = named && !/^helena-[a-z0-9-]+\//.test(named) ? named : prettyModelId(id);
  return isLocalId(id) && !/\(.*\)/.test(label) ? `${label} (${words.local})` : label;
}

// The models the task classes name (not agent models): words for the few there are.
export function classModelLabel(
  id: string,
  words: { localDefault: string; local: string; configured: string },
): string {
  if (id === 'volition-local-default') return words.localDefault;
  if (id === 'configured-tts') return words.configured;
  if (/^jev/i.test(id)) return 'Jev';
  if (/^whisper/i.test(id)) return 'Whisper';
  const gemma = /^embed-?gemma:?(\d+m)?/i.exec(id);
  if (gemma) return `EmbeddingGemma${gemma[1] ? ` ${gemma[1].toUpperCase()}` : ''}`;
  const embedding = /^Qwen3-Embedding-(\d+(?:\.\d+)?B)/i.exec(id);
  if (embedding) return `Qwen3 Embedding ${embedding[1]!.toUpperCase()}`;
  const flm = /^qwen(\d+(?:\.\d+)?):(\d+b)$/i.exec(id);
  if (flm) return `Qwen${flm[1]} ${flm[2]!.toUpperCase()}`;
  return modelLabel(id, words);
}
