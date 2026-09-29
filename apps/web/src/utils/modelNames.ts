// A model as people call it (owner, 28.09.: "Helena · Flash (lokal)", not the id of the
// weights file): the product name for the known families, the model's own id otherwise.
// `local` says it runs on Helena's own server (a `helena-<slug>/…` id).

export interface FriendlyModel {
  name: string;
  local: boolean;
}

const LOCAL = /^helena-[a-z0-9-]+\/(.+)$/;

function title(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word;
}

export function friendlyModel(modelId: string | null | undefined): FriendlyModel | null {
  const id = modelId?.trim();
  if (!id) return null;
  const localMatch = LOCAL.exec(id);
  const local = localMatch != null;
  const raw = (localMatch?.[1] ?? id).replace(/^halogen-/i, '');
  const bare = raw.replace(/(?:[-.](?:gguf|mtp))+$/i, '');

  // Qwen3.8 Flash Next and its kin: "Flash".
  if (/(^|[-_. ])flash([-_. ]|$)/i.test(bare)) return { name: 'Flash', local };
  const claude = /^(?:claude-)?(opus|sonnet|haiku|fable)[- ]?(\d+)(?:[-.](\d+))?/i.exec(bare);
  if (claude) {
    const version = claude[3] ? `${claude[2]}.${claude[3]}` : claude[2];
    return { name: `${title(claude[1]!.toLowerCase())} ${version}`, local };
  }
  const gpt = /^gpt-(\d+(?:\.\d+)?)(?:-([a-z]+))?/i.exec(bare);
  if (gpt) {
    return { name: `GPT-${gpt[1]}${gpt[2] ? ` ${title(gpt[2].toLowerCase())}` : ''}`, local };
  }
  const qwen = /^qwen(\d+(?:\.\d+)?)/i.exec(bare);
  if (qwen) return { name: `Qwen${qwen[1]}`, local };
  return { name: bare, local };
}
