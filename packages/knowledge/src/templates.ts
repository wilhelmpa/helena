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

// Note templates and daily notes the way Obsidian's core plugins keep them, so Helena
// and Obsidian agree without a plugin: the templates are Markdown files in Templates/
// (`.obsidian/templates.json` names the folder), with Obsidian's variables {{title}},
// {{date}}, {{time}} and {{date:FORMAT}}; the daily note's folder, name format and
// template come from `.obsidian/daily-notes.json`. Helena seeds both once and then only
// reads them, so the owner's changes (in Obsidian or in Helena) win.

export const DAILY_NOTES_CONFIG = '.obsidian/daily-notes.json';
export const TEMPLATES_CONFIG = '.obsidian/templates.json';
const SEEDED_KEY = 'knowledge.templatesSeeded';

export interface DailyNotesConfig {
  folder: string;
  // A moment.js format, as Obsidian stores it. Helena understands the tokens below.
  format: string;
  // A vault path without ".md", as Obsidian stores it; empty for none.
  template: string;
}

export const DEFAULT_DAILY_NOTES: DailyNotesConfig = {
  folder: 'Home/Docs/Journal',
  format: 'YYYY-MM-DD',
  template: `${TEMPLATES_DIR}/Tagesnotiz`,
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

// Fills Obsidian's template variables.
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

async function readJson<T>(relative: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(absoluteVaultPath(relative), 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function dailyNotesConfig(): Promise<DailyNotesConfig> {
  const stored = await readJson<Partial<DailyNotesConfig>>(DAILY_NOTES_CONFIG);
  return {
    folder: (stored?.folder ?? DEFAULT_DAILY_NOTES.folder).replace(/^\/+|\/+$/g, ''),
    format: stored?.format?.trim() || DEFAULT_DAILY_NOTES.format,
    template: (stored?.template ?? DEFAULT_DAILY_NOTES.template).replace(/^\/+|\.md$/g, ''),
  };
}

export async function templatesFolder(): Promise<string> {
  const stored = await readJson<{ folder?: string }>(TEMPLATES_CONFIG);
  return (stored?.folder ?? TEMPLATES_DIR).replace(/^\/+|\/+$/g, '') || TEMPLATES_DIR;
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

// The five starter templates, German and English. Obsidian variables only.
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

// Writes the starter templates and Obsidian's two config files once per instance, in
// the instance's language. A file that exists is never replaced, and a template the
// owner deleted later does not come back.
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
  const daily = {
    ...DEFAULT_DAILY_NOTES,
    template: `${TEMPLATES_DIR}/${language === 'de' ? 'Tagesnotiz' : 'Daily note'}`,
  };
  await put(DAILY_NOTES_CONFIG, `${JSON.stringify(daily, null, 2)}\n`);
  await put(TEMPLATES_CONFIG, `${JSON.stringify({ folder: TEMPLATES_DIR }, null, 2)}\n`);
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
