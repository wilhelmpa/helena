import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { isDisallowedRef, parseFrontmatter } from '#modules/agents/skills/skill-format';

export interface Finding {
  code: string;
  severity: 'block' | 'review' | 'info';
  path: string;
  detail: string;
}
export interface SnapshotFile {
  path: string;
  content: string;
  size: number;
  sha256: string;
}
export interface Snapshot {
  files: SnapshotFile[];
  markdown: string;
  permissions: string[];
  environment: string[];
  command?: string;
  args?: string[];
}

const allowedLicenses = new Set([
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  'Unlicense',
]);
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export const hasPossibleSecret = (content: string) =>
  /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9]{32,})/.test(
    content,
  );

export function identifyLicense(
  files: { path: string; bytes: Buffer }[],
  declared?: string | null,
): string | null {
  if (declared && allowedLicenses.has(declared)) return declared;
  const license = files.find((f) => /^(LICENSE|LICENCE)(\.[A-Za-z0-9-]+)?$/i.test(f.path));
  const content = license?.bytes.toString('utf8').slice(0, 1500) ?? '';
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(content)) return 'AGPL-3.0-only';
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(content) && /Version 3/i.test(content))
    return 'LGPL-3.0-only';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(content) && /Version 3/i.test(content))
    return 'GPL-3.0-only';
  if (/Apache License\s+Version 2\.0/i.test(content)) return 'Apache-2.0';
  if (/Permission is hereby granted, free of charge/i.test(content)) return 'MIT';
  if (/Redistribution and use in source and binary forms/i.test(content)) return 'BSD-3-Clause';
  return declared ?? null;
}

export function inspectSkillFiles(
  files: { path: string; bytes: Buffer }[],
  declaredLicense?: string | null,
) {
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const findings: Finding[] = [];
  const license = identifyLicense(ordered, declaredLicense);
  if (!license || !allowedLicenses.has(license)) {
    findings.push({
      code: 'license',
      severity: 'block',
      path: '',
      detail: `License ${license ?? 'unknown'} is not verified as AGPL compatible`,
    });
  }
  const markdown = ordered.find((f) => f.path === 'SKILL.md')?.bytes.toString('utf8') ?? '';
  if (!markdown)
    findings.push({
      code: 'skill-format',
      severity: 'block',
      path: 'SKILL.md',
      detail: 'SKILL.md is missing',
    });
  const metadata = parseFrontmatter(markdown);
  if (!metadata.name || !metadata.description)
    findings.push({
      code: 'skill-format',
      severity: 'block',
      path: 'SKILL.md',
      detail: 'Name and description frontmatter are required',
    });
  for (const file of ordered) {
    const content = file.bytes.toString('utf8');
    if (isDisallowedRef(file.path) || file.bytes.subarray(0, 2).toString() === '#!') {
      findings.push({
        code: 'executable',
        severity: 'review',
        path: file.path,
        detail: 'Executable script; catalog import excludes it',
      });
    }
    if (hasPossibleSecret(content)) {
      findings.push({
        code: 'secret',
        severity: 'block',
        path: file.path,
        detail: 'Possible credential or private key',
      });
    }
    if (
      /(?:ignore (?:all |any )?(?:previous|prior|system|developer) instructions|reveal (?:your |the )?(?:system prompt|secrets)|disable (?:safety|guardrails)|exfiltrat(?:e|ion))/i.test(
        content,
      )
    ) {
      findings.push({
        code: 'prompt-injection',
        severity: 'review',
        path: file.path,
        detail: 'Suspicious instruction pattern',
      });
    }
    if (
      /(?:\b(?:curl|wget|nc|ncat|ssh|scp)\b|https?:\/\/|\b(?:exec|spawn|subprocess|os\.system|child_process)\b)/i.test(
        content,
      ) &&
      isDisallowedRef(file.path)
    ) {
      findings.push({
        code: 'network-shell',
        severity: 'review',
        path: file.path,
        detail: 'Network or shell operation in executable file',
      });
    }
  }
  const snapshot: Snapshot = {
    files: ordered.map((file) => ({
      path: file.path,
      content: findings.some((finding) => finding.code === 'secret' && finding.path === file.path)
        ? ''
        : file.bytes.toString('base64'),
      size: file.bytes.length,
      sha256: hash(file.bytes),
    })),
    markdown: findings.some((finding) => finding.code === 'secret' && finding.path === 'SKILL.md')
      ? '[redacted: suspected secret]'
      : markdown,
    permissions: [],
    environment: [],
  };
  const digest = hash(ordered.map((file) => `${file.path}\0${hash(file.bytes)}\n`).join(''));
  return {
    snapshot,
    findings,
    license,
    sha256: digest,
    size: ordered.reduce((sum, file) => sum + file.bytes.length, 0),
    name: metadata.name ?? '',
    description: metadata.description ?? '',
  };
}

export function unpackTarGz(bytes: Buffer): { path: string; bytes: Buffer; executable: boolean }[] {
  const tar = gunzipSync(bytes, { maxOutputLength: 25 * 1024 * 1024 });
  const files: { path: string; bytes: Buffer; executable: boolean }[] = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/, '');
    const name = field(0, 100);
    const prefix = field(345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(field(124, 12).trim(), 8);
    const mode = Number.parseInt(field(100, 8).trim(), 8);
    const type = field(156, 1);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length)
      throw new Error('Invalid catalog archive');
    if (type === '' || type === '0') {
      if (files.length >= 500) throw new Error('Catalog archive has too many files');
      files.push({
        path,
        bytes: tar.subarray(offset + 512, offset + 512 + size),
        executable: Boolean(mode & 0o111),
      });
    } else if (type !== '5' && type !== 'x') {
      throw new Error('Catalog archive contains unsupported links or special files');
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

export function inspectMcpPackage(input: {
  name: string;
  version: string;
  license?: string | null;
  command?: string;
  args?: string[];
  environment?: string[];
  permissions?: string[];
  scripts?: Record<string, string>;
  dependencies?: string[];
  integrity?: string;
  files?: { path: string; bytes: Buffer; executable: boolean }[];
  archiveSha256?: string;
}) {
  const findings: Finding[] = [];
  const license = input.license ?? null;
  if (!license || !allowedLicenses.has(license))
    findings.push({
      code: 'license',
      severity: 'block',
      path: '',
      detail: `License ${license ?? 'unknown'} is not verified as AGPL compatible`,
    });
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.version))
    findings.push({
      code: 'pin',
      severity: 'block',
      path: '',
      detail: 'An exact package version is required',
    });
  if (!input.integrity)
    findings.push({
      code: 'hash',
      severity: 'block',
      path: '',
      detail: 'Package integrity hash is missing',
    });
  if (input.dependencies?.length)
    findings.push({
      code: 'unscanned-dependencies',
      severity: 'block',
      path: '',
      detail: `${input.dependencies.length} runtime dependencies are not pinned and inspected`,
    });
  for (const [name, script] of Object.entries(input.scripts ?? {})) {
    findings.push({
      code: 'executable',
      severity: 'review',
      path: `scripts/${name}`,
      detail: 'Package lifecycle script requires review',
    });
    if (/(?:curl|wget|https?:\/\/|\b(?:sh|bash|exec|spawn)\b)/i.test(script))
      findings.push({
        code: 'network-shell',
        severity: 'review',
        path: `scripts/${name}`,
        detail: 'Network or shell operation in package script',
      });
  }
  for (const file of input.files ?? []) {
    const content = file.bytes.toString('utf8');
    const executable = file.executable || isDisallowedRef(file.path);
    if (executable)
      findings.push({
        code: 'executable',
        severity: 'review',
        path: file.path,
        detail: 'Executable file in package',
      });
    if (hasPossibleSecret(content))
      findings.push({
        code: 'secret',
        severity: 'block',
        path: file.path,
        detail: 'Possible credential or private key',
      });
    if (
      /(?:ignore (?:all |any )?(?:previous|prior|system|developer) instructions|reveal (?:your |the )?(?:system prompt|secrets)|disable (?:safety|guardrails)|exfiltrat(?:e|ion))/i.test(
        content,
      )
    )
      findings.push({
        code: 'prompt-injection',
        severity: 'review',
        path: file.path,
        detail: 'Suspicious instruction pattern',
      });
    if (
      executable &&
      /(?:\b(?:curl|wget|nc|ncat|ssh|scp)\b|https?:\/\/|\b(?:exec|spawn|subprocess|os\.system|child_process)\b)/i.test(
        content,
      )
    )
      findings.push({
        code: 'network-shell',
        severity: 'review',
        path: file.path,
        detail: 'Network or shell operation in executable file',
      });
  }
  const snapshot: Snapshot = {
    files: (input.files ?? []).map((file) => ({
      path: file.path,
      content:
        !findings.some((finding) => finding.code === 'secret' && finding.path === file.path) &&
        /\.(?:md|txt|json|toml|sh|js|ts|py)$/i.test(file.path) &&
        file.bytes.length < 65536
          ? file.bytes.toString('base64')
          : '',
      size: file.bytes.length,
      sha256: hash(file.bytes),
    })),
    markdown: '',
    permissions: input.permissions ?? [],
    environment: input.environment ?? [],
    command: input.command,
    args: input.args ?? [],
  };
  return {
    snapshot,
    findings,
    license,
    sha256: input.archiveSha256 ?? input.integrity ?? '',
    size: (input.files ?? []).reduce((sum, file) => sum + file.bytes.length, 0),
    name: input.name,
    description: '',
  };
}

export const inspectionPasses = (findings: Finding[]) =>
  !findings.some((finding) => finding.severity === 'block');
