// Code an answer shows as a live preview: an HTML page or an SVG image. The preview is a
// sandboxed frame with the document as its srcdoc, with scripts allowed but no same
// origin, so it can neither read Plan's cookies and storage nor call Plan's API, and
// with a policy of its own that keeps it from loading anything from the network.
export const ARTIFACT_LANGUAGES = ['html', 'svg'] as const;

export type ArtifactLanguage = (typeof ARTIFACT_LANGUAGES)[number];

export const isArtifactLanguage = (language: string): language is ArtifactLanguage =>
  (ARTIFACT_LANGUAGES as readonly string[]).includes(language.toLowerCase());

export const ARTIFACT_SANDBOX = 'allow-scripts';

export const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  'img-src data: blob:; font-src data:; media-src data: blob:';

export interface Artifact {
  language: ArtifactLanguage;
  code: string;
}

export function artifactDocument({ language, code }: Artifact): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
  if (language === 'svg') {
    return `<!doctype html><html><head>${head}<style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${code}</body></html>`;
  }
  if (/<head[\s>]/i.test(code)) return code.replace(/<head([^>]*)>/i, `<head$1>${head}`);
  return `<!doctype html><html><head>${head}</head><body>${code}</body></html>`;
}

// The fenced code blocks of an answer that are shown as artifacts: ```html or ```svg,
// tagged or not — an agent writing a full page fences it as html without necessarily
// naming it "artifact". Only complete fences count, so a block still streaming in does
// not flash open before the model has finished it.
const FENCE = /```(html|svg)\r?\n([\s\S]*?)```/gi;

export function extractArtifacts(text: string): Artifact[] {
  const found: Artifact[] = [];
  for (const match of text.matchAll(FENCE)) {
    const language = match[1].toLowerCase() as ArtifactLanguage;
    const code = match[2].trim();
    if (code) found.push({ language, code });
  }
  return found;
}

// The answer's prose with its artifact fences taken out, and the artifacts themselves —
// the bubble shows the artifact as a card in the fence's place, not the raw code, the
// way an image markdown shows a picture instead of its own syntax.
export function splitArtifacts(text: string): { text: string; artifacts: Artifact[] } {
  const artifacts = extractArtifacts(text);
  return { text: text.replace(FENCE, '').trim(), artifacts };
}

// The name an artifact is saved under in the vault.
export function artifactFileName(language: ArtifactLanguage, title: string | null, now: Date) {
  const base = (title ?? 'artifact')
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `${base || 'artifact'} ${stamp}.${language}`;
}
