// Token ids for `logit_bias` (docs/helena-decisions/halogen.md §6). llama.cpp's llama-server
// (and Lemonade, which passes the body through) takes a `logit_bias` key as text and tokenizes it
// itself; other OpenAI-compatible servers take token ids only, as OpenAI's API does (Halogen).
// For those the local logit readout looks each option letter up in the model's tokenizer and
// biases its id instead.

// The token id of each text that is exactly one token, else null.
export type TokenIds = (texts: string[], signal?: AbortSignal) => Promise<(number | null)[]>;

// A byte-level BPE vocabulary (a Hugging Face `vocab.json`: token text → id). ASCII letters and
// digits are their own token text; a leading space would be `Ġ`, which an answer's first token
// does not have. Only an exact single token counts: a text the vocabulary splits has no id.
export function singleTokenIds(vocab: Record<string, unknown>, texts: string[]): (number | null)[] {
  return texts.map((text) => {
    const id = Object.prototype.hasOwnProperty.call(vocab, text) ? vocab[text] : undefined;
    return typeof id === 'number' && Number.isInteger(id) && id >= 0 ? id : null;
  });
}

// `logit_bias` for letters: by token id where the server needs ids, else by the letters
// themselves. Throws when a letter is not a single token of the tokenizer, because a bias on
// the wrong token would silently skew the readout.
export async function letterBias(
  letters: string[],
  bias: number,
  tokenIds?: TokenIds,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  if (!tokenIds) return Object.fromEntries(letters.map((letter) => [letter, bias]));
  const ids = await tokenIds(letters, signal);
  const out: Record<string, number> = {};
  letters.forEach((letter, index) => {
    const id = ids[index];
    if (id === null || id === undefined)
      throw new Error(`the tokenizer has no single token for the option letter ${letter}`);
    out[String(id)] = bias;
  });
  return out;
}
