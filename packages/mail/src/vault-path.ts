// Vault-relative locations of mail files, shared by the importer and the api:
//   attachments  Projects/<KEY>/Files/Mail/<YYYY>/<MM>/<YYYY-MM-DD> <sender> - <subject>/<file>
//   notes        Projects/<KEY>/Docs/Mail/<YYYY-MM-DD> <subject>.md
// A mail without a project uses Home/ in place of Projects/<KEY>/.

const MAX_SEGMENT = 120;
const UNSAFE = new Set('/\\:*?"<>|');

function isUnsafe(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f || UNSAFE.has(char);
}

export function safeSegment(value: string, fallback: string, max = MAX_SEGMENT): string {
  const replaced = [...value].map((char) => (isUnsafe(char) ? ' ' : char)).join('');
  const cleaned = replaced.replace(/\s+/g, ' ').trim();
  const cut = [...cleaned].slice(0, max).join('');
  const trimmed = cut.replace(/^[.\s]+|[.\s]+$/g, '');
  return trimmed || fallback;
}

// Keeps the extension of a file name when the base has to be shortened.
export function safeFileName(name: string, fallback = 'attachment'): string {
  const cleaned = safeSegment(name, fallback, Number.MAX_SAFE_INTEGER);
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  const base = extension ? cleaned.slice(0, dot) : cleaned;
  return `${safeSegment(base, fallback)}${extension}`;
}

// "report.pdf" → "report (2).pdf"; a folder name has no extension to keep.
export function withSuffix(name: string, attempt: number, keepExtension: boolean): string {
  if (attempt <= 1) return name;
  const dot = keepExtension ? name.lastIndexOf('.') : -1;
  return dot > 0 ? `${name.slice(0, dot)} (${attempt})${name.slice(dot)}` : `${name} (${attempt})`;
}

export function mailScopeRoot(projectKey: string | null): string {
  return projectKey ? `Projects/${projectKey}` : 'Home';
}

function datePart(date: Date): { year: string; month: string; day: string } {
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  };
}

export function mailDateLabel(date: Date): string {
  const { year, month, day } = datePart(date);
  return `${year}-${month}-${day}`;
}

export interface MailPathInput {
  projectKey: string | null;
  date: Date;
  senderName: string;
  subject: string;
}

// The attachment folder of one message, relative to the scope's Files/Mail folder.
export function mailAttachmentFolderName(input: Omit<MailPathInput, 'projectKey'>): string {
  const { year, month } = datePart(input.date);
  const sender = safeSegment(input.senderName, 'Unknown sender', 60);
  const subject = safeSegment(input.subject, 'No subject', 80);
  return `${year}/${month}/${mailDateLabel(input.date)} ${sender} - ${subject}`;
}

export function mailAttachmentFolder(input: MailPathInput): string {
  return `${mailScopeRoot(input.projectKey)}/Files/Mail/${mailAttachmentFolderName(input)}`;
}

export function mailNotePath(input: Omit<MailPathInput, 'senderName'>): string {
  const subject = safeSegment(input.subject, 'No subject', 100);
  return `${mailScopeRoot(input.projectKey)}/Docs/Mail/${mailDateLabel(input.date)} ${subject}.md`;
}

// Replaces the scope root of a mail path, for a thread that moves to another project.
export function moveMailPath(vaultPath: string, projectKey: string | null): string {
  const match = /^(?:Projects\/[^/]+|Home)\/(.*)$/.exec(vaultPath);
  if (!match) throw new Error('Not a mail vault path');
  return `${mailScopeRoot(projectKey)}/${match[1]}`;
}
