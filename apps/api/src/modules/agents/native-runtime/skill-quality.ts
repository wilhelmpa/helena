import { looksSecret } from '@helena/facts';
import { HttpError } from '#shared/lib';
import { parseFrontmatter } from '../skills/skill-format';
import type { LearnedSkill } from '../learning/service';

export function similarSkill(a: LearnedSkill, b: LearnedSkill): boolean {
  const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const overlap = (a: Set<string>, b: Set<string>) => {
    const intersection = [...a].filter((word) => b.has(word)).length;
    return intersection / Math.max(1, a.size + b.size - intersection);
  };
  const body = (s: LearnedSkill) =>
    s.markdown.replace(/^---[\s\S]*?---/, '').replace(/^#+.*$/gm, '');
  return (
    a.name.toLowerCase() === b.name.toLowerCase() ||
    overlap(words(a.name), words(b.name)) >= 0.8 ||
    (words(body(a)).size >= 12 && overlap(words(body(a)), words(body(b))) >= 0.85)
  );
}

export function skillDescription(skill: LearnedSkill): string {
  return parseFrontmatter(skill.markdown).description ?? skill.name;
}

export function skillQuality(skill: LearnedSkill): string[] {
  const issues: string[] = [];
  try {
    validateNativeSkill(skill);
  } catch {
    issues.push('Unsafe or incomplete skill');
  }
  const meta = parseFrontmatter(skill.markdown);
  if (!meta.name || !meta.description) issues.push('Name and when-to-use description required');
  if (meta.name !== skill.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.name ?? ''))
    issues.push('Frontmatter name must match the lowercase skill name');
  for (const heading of ['Steps', 'Pitfalls', 'Examples']) {
    if (!new RegExp(String.raw`^## ${heading}\s*\n\s*\S`, 'm').test(skill.markdown))
      issues.push(`Nonempty ${heading} section required`);
  }
  const steps = skill.markdown.split(/^## Steps\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const numbered = steps.match(/^\s*(?:\d+[.)]|[-*])\s+\S/gm)?.length ?? 0;
  const clauses = steps.split(/[,;\n]|\b(?:then|danach)\b/iu).filter((part) => part.trim()).length;
  if (Math.max(numbered, clauses) < 2)
    issues.push('At least two concrete procedure steps required');
  if (
    !/\b(?:when|whenever|monthly|weekly|repeated|recurring|bei|wenn|regelmäßig|monatlich)\b/iu.test(
      meta.description ?? '',
    )
  )
    issues.push('Description must state a reusable trigger');
  if (
    /\b(?:one[- ]?off|one[- ]?time|einmalig|einmalige|nur diesmal)\b/iu.test(
      `${meta.description ?? ''}\n${steps}`,
    )
  )
    issues.push('A one-time result is not a reusable procedure');
  return issues;
}

export function oneOffSkillSource(text: string): boolean {
  // A source task can explicitly ask for a reusable procedure and include a warning
  // against one-off results. That warning describes the skill's pitfalls, not the task.
  const reusableRequest =
    /\b(?:learn|create|save|write|lerne|erstelle|speichere|schreibe)\b[^.!?\n]{0,160}\b(?:reusable|wiederverwendbar\p{L}*)\b/iu.test(
      text,
    ) &&
    !/\b(?:do not|don't|never|nicht|kein\p{L}*)\b[^.!?\n]{0,160}\b(?:reusable|wiederverwendbar\p{L}*)\b/iu.test(
      text,
    );
  const recurring =
    reusableRequest ||
    /\b(?:monatlich|wöchentlich|regelmäßig|wiederkehrend|monthly|weekly|recurring|each month|every week)\b/iu.test(
      text,
    );
  const transient =
    /\b(?:einmalig|einmalige|nur diesmal|one[- ]?off|one[- ]?time|momentan(?:en|e|er)?|current|aktuell(?:en|e|er)?)\b/iu.test(
      text,
    );
  const lookup =
    /\b(?:zähler|counter|status|lookup|abfrage|nachschlagen|read|lies|summe|sum)\b/iu.test(text);
  return !recurring && (transient || lookup);
}

export function validateNativeSkill(skill: LearnedSkill): void {
  const safe = (path: string) =>
    path
      .split('/')
      .every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');
  if (!safe(skill.path) || skill.files.some((file) => !safe(file.path) || file.path === 'SKILL.md'))
    throw new HttpError(400, 'Invalid skill path');
  if (new Set(skill.files.map((file) => file.path)).size !== skill.files.length)
    throw new HttpError(400, 'Duplicate skill file');
  if (skill.truncated || skill.otherFiles || !skill.markdown.trim())
    throw new HttpError(400, 'A native skill must include its complete content and files');
  if (
    skill.markdown.length > 32_000 ||
    skill.files.length > 16 ||
    skill.files.reduce((bytes, file) => bytes + file.content.length, 0) > 128_000
  )
    throw new HttpError(413, 'Learned skill content is too large');
  const content = [
    skill.path,
    skill.name,
    skill.markdown,
    ...skill.files.flatMap((file) => [file.path, file.content]),
  ];
  const credentialPath =
    /(?:\.ssh\/|\.aws\/|\.kube\/config|\.env(?:[./\s]|$)|\.npmrc|id_(?:rsa|ed25519)|\/(?:secrets?|credentials?)\/|\.(?:pem|key)(?:\s|$)|[?&](?:key|token|secret)=)/i;
  if (content.some((text) => looksSecret(text) || credentialPath.test(text)))
    throw new HttpError(400, 'The skill looks like it holds a secret');
}
