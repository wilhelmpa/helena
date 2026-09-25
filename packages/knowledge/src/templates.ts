import { readFile } from 'node:fs/promises';
import { and, eq, like } from 'drizzle-orm';
import { appSetting, db, vaultEntry } from '@repo/db';
import {
  absoluteVaultPath,
  belowPattern,
  commitVaultPaths,
  indexVaultPaths,
  PLAN_AUTHOR,
  TEMPLATES_DIR,
  VaultError,
  writeVaultFile,
} from '@repo/vault';

// Note templates and daily notes. The templates are Markdown files in Templates/ with the
// variables {{title}}, {{date}}, {{time}} and {{date:FORMAT}} (a moment.js format); the daily
// note is Home/Docs/Journal/YYYY-MM-DD.md, made from Templates/Tagesnotiz (Templates/Daily
// note on an English instance) and tagged `journal`. The notes (SilverBullet) keep their
// journal in the same folder (deployment/volition-stack/native/notes/CONFIG.md.in), so
// Helena's daily note and the notes' "Journal: Today" are one file. Helena seeds the
// templates once; the owner's changes to them win.

const SEEDED_KEY = 'knowledge.templatesSeeded';

export interface DailyNotesConfig {
  folder: string;
  // A moment.js format. Helena understands the tokens formatDate lists.
  format: string;
  // A vault path without ".md"; empty for none.
  template: string;
}

export const DAILY_NOTES_FOLDER = 'Home/Docs/Journal';
const DAILY_TEMPLATES = [`${TEMPLATES_DIR}/Tagesnotiz`, `${TEMPLATES_DIR}/Daily note`];

export const DEFAULT_DAILY_NOTES: DailyNotesConfig = {
  folder: DAILY_NOTES_FOLDER,
  format: 'YYYY-MM-DD',
  template: DAILY_TEMPLATES[0]!,
};

const WEEKDAYS: Record<string, string[]> = {
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const MONTHS: Record<string, string[]> = {
  de: [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};

// The parts of a moment.js format the templates use: YYYY YY MMMM MM M DD D dddd ddd
// HH H mm ss, and [literal text]. The date is taken in `timeZone`.
export function formatDate(date: Date, format: string, locale = 'de', timeZone?: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? '');
  const language = locale.split('-')[0] === 'de' ? 'de' : 'en';
  const pad = (value: number | string) => String(value).padStart(2, '0');
  const tokens: Record<string, string> = {
    YYYY: String(year),
    YY: String(year).slice(-2),
    MMMM: MONTHS[language]![month - 1]!,
    MM: pad(month),
    M: String(month),
    DD: pad(day),
    D: String(day),
    dddd: WEEKDAYS[language]![weekday]!,
    ddd: WEEKDAYS[language]![weekday]!.slice(0, language === 'de' ? 2 : 3),
    HH: pad(parts.hour ?? 0),
    H: String(Number(parts.hour ?? 0)),
    mm: pad(parts.minute ?? 0),
    ss: pad(parts.second ?? 0),
  };
  return format.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss/g,
    (match, literal: string | undefined) => literal ?? tokens[match] ?? match,
  );
}

// Fills the template variables.
export function expandTemplate(
  template: string,
  values: { title: string; date: Date; locale?: string; timeZone?: string },
): string {
  const locale = values.locale ?? 'de';
  return template.replace(
    /\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/g,
    (_match, name, format) => {
      if (name === 'title') return values.title;
      const fallback = name === 'date' ? 'YYYY-MM-DD' : 'HH:mm';
      return formatDate(
        values.date,
        (format as string | undefined)?.trim() || fallback,
        locale,
        values.timeZone,
      );
    },
  );
}

// The daily note settings: the folder and name are fixed; the template is the seeded one of
// the instance's language that exists (none when the owner deleted both).
export async function dailyNotesConfig(): Promise<DailyNotesConfig> {
  let template = '';
  for (const candidate of DAILY_TEMPLATES) {
    if ((await readTemplate(`${candidate}.md`)) !== null) {
      template = candidate;
      break;
    }
  }
  return { ...DEFAULT_DAILY_NOTES, template };
}

export async function templatesFolder(): Promise<string> {
  return TEMPLATES_DIR;
}

export interface TemplateInfo {
  path: string;
  name: string;
}

// The templates in the templates folder, by name.
export async function listTemplates(): Promise<TemplateInfo[]> {
  const folder = await templatesFolder();
  const rows = await db
    .select({ path: vaultEntry.path, title: vaultEntry.title })
    .from(vaultEntry)
    .where(and(eq(vaultEntry.kind, 'note'), like(vaultEntry.path, belowPattern(folder))));
  return rows
    .map((row) => ({
      path: row.path,
      name: row.path.slice(folder.length + 1).replace(/\.md$/i, ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function readTemplate(relative: string): Promise<string | null> {
  try {
    return await readFile(absoluteVaultPath(relative), 'utf8');
  } catch {
    return null;
  }
}

// The five starter templates, German and English. Only the variables above.
const STARTERS: Record<'de' | 'en', Record<string, string>> = {
  de: {
    Tagesnotiz: `---
typ: tagesnotiz
datum: {{date}}
tags: [journal]
---
# {{date:dddd, D. MMMM YYYY}}

## Fokus heute
-

## Notizen


## Eingang
<!-- Schnell erfasste Gedanken landen hier. -->

## Rückblick
- Was lief gut?
- Was nehme ich mit?
`,
    Meeting: `---
typ: meeting
datum: {{date}}
teilnehmer: []
tags: [meeting]
---
# {{title}}

**Datum:** {{date}} {{time}}

## Ziel


## Notizen


## Entscheidungen
-

## Aufgaben
- [ ]
`,
    Entscheidung: `---
typ: entscheidung
datum: {{date}}
status: vorgeschlagen
tags: [entscheidung]
---
# {{title}}

## Kontext
Worum geht es, und warum muss jetzt entschieden werden?

## Optionen
1.
2.

## Entscheidung


## Folgen
Was wird dadurch einfacher, was schwerer?
`,
    Recherche: `---
typ: recherche
datum: {{date}}
quellen: []
tags: [recherche]
---
# {{title}}

## Frage


## Ergebnis in einem Satz


## Erkenntnisse
-

## Quellen
-

## Offene Punkte
-
`,
    Projektbrief: `---
typ: projektbrief
datum: {{date}}
status: entwurf
tags: [projekt]
---
# {{title}}

## Ziel
Was soll am Ende anders sein?

## Hintergrund


## Umfang
**Dazu gehört:**
-

**Nicht dazu gehört:**
-

## Erfolgskriterien
-

## Beteiligte


## Meilensteine
- [ ]
`,
  },
  en: {
    'Daily note': `---
type: daily
date: {{date}}
tags: [journal]
---
# {{date:dddd, MMMM D, YYYY}}

## Focus today
-

## Notes


## Inbox
<!-- Quick captures land here. -->

## Review
- What went well?
- What do I take away?
`,
    Meeting: `---
type: meeting
date: {{date}}
attendees: []
tags: [meeting]
---
# {{title}}

**Date:** {{date}} {{time}}

## Goal


## Notes


## Decisions
-

## Action items
- [ ]
`,
    Decision: `---
type: decision
date: {{date}}
status: proposed
tags: [decision]
---
# {{title}}

## Context


## Options
1.
2.

## Decision


## Consequences
`,
    Research: `---
type: research
date: {{date}}
sources: []
tags: [research]
---
# {{title}}

## Question


## Answer in one sentence


## Findings
-

## Sources
-

## Open questions
-
`,
    'Project brief': `---
type: project-brief
date: {{date}}
status: draft
tags: [project]
---
# {{title}}

## Goal


## Background


## Scope
**In:**
-

**Out:**
-

## Success criteria
-

## People


## Milestones
- [ ]
`,
  },
};

// The daily note heading quick captures are appended under, per template language.
export const INBOX_HEADINGS = ['## Eingang', '## Inbox'];

async function seeded(): Promise<boolean> {
  const [row] = await db.select().from(appSetting).where(eq(appSetting.key, SEEDED_KEY));
  return row?.value === true;
}

// Writes the starter templates once per instance, in the instance's language. A file that
// exists is never replaced, and a template the owner deleted later does not come back.
export async function seedTemplates(language: 'de' | 'en' = 'de'): Promise<string[]> {
  if (await seeded()) return [];
  const written: string[] = [];
  const put = async (relative: string, content: string) => {
    try {
      await writeVaultFile(relative, Buffer.from(content), null);
      written.push(relative);
    } catch (error) {
      if (!(error instanceof VaultError && error.code === 'exists')) throw error;
    }
  };
  for (const [name, content] of Object.entries(STARTERS[language])) {
    await put(`${TEMPLATES_DIR}/${name}.md`, content);
  }
  if (written.length > 0) {
    await indexVaultPaths(written);
    await commitVaultPaths(written, 'Add note templates', PLAN_AUTHOR);
  }
  await db
    .insert(appSetting)
    .values({ key: SEEDED_KEY, value: true })
    .onConflictDoUpdate({ target: appSetting.key, set: { value: true, updatedAt: new Date() } });
  return written;
}
