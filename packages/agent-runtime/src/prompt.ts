import type { SkillEntry } from './config';
import type { MemoryState } from './helena-client';

// The system prompt of a command: the agent's standing instructions (its SOUL in Helena), the
// run's own context the runner hands over, the loop's working rules, the memory Helena keeps
// for the agent, the index of its skills and what its tool servers say about their use.

const MEMORY_CHARS = 3_000;
const COMMON_WORDS = new Set(
  'the and for with this that from have please use can der die das und für mit den dem des ein eine einer einem einen ist sind auf aus von zum zur bitte nutze'.split(
    ' ',
  ),
);

const RULES = [
  '## Arbeitsweise',
  '- Du arbeitest selbständig mit deinen Werkzeugen, bis die Aufgabe erledigt ist. Rufe Werkzeuge direkt auf; erfinde keine Ergebnisse.',
  '- Wenn ein Werkzeug fehlt, suche es mit find_tools. Wenn eine Aufgabe zu einem deiner Skills passt, lade ihn zuerst mit load_skill.',
  '- Wenn ein passendes Werkzeug bereits angeboten wird, rufe es direkt auf. Suche nur mit find_tools, wenn keines passt.',
  '- Ein Werkzeug, das "BLOCKED" antwortet, darfst du nicht auf anderem Weg umgehen. Beende dann den Zug und nenne den Grund.',
  '- Wiederhole keinen Aufruf, der nichts geändert hat. Wenn du feststeckst, sag es.',
  '- Nach einem erfolgreichen Schreibaufruf mit eindeutiger Bestätigung antworte mit diesem Ergebnis. Frage weitere Werkzeuge nur ab, wenn die Bestätigung für die Aufgabe nicht ausreicht.',
  '- Für Lesen, Suchen, Auflisten und Bearbeiten lokaler Dateien verwende die angebotenen Werkzeuge für Dateien. Wiederhole eine beantwortete Dateiabfrage nicht mit shell (etwa ls oder cat); nutze shell für Git, Tests und Befehle, die diese Werkzeuge nicht abdecken.',
  '- Bei einer Leseaufgabe: Sobald ein Werkzeug das gesuchte Faktum eindeutig liefert, antworte damit und nenne die vorhandene Quelle. Rufe danach kein weiteres Browser- oder Suchwerkzeug auf. Suche nur weiter, wenn der Befund widersprüchlich oder unklar ist.',
  '- Bei einer Aufgabe mit mehreren Schritten: Wenn ein Leseergebnis das für den nächsten Schritt benötigte Faktum samt Quelle eindeutig nennt, verwende es direkt. Öffne die Quelle nur bei fehlenden oder widersprüchlichen Angaben.',
  '- Frag nur mit clarify nach, wenn es ohne die Antwort nicht weitergeht.',
  '- Am Ende: eine kurze, klare Antwort auf Deutsch (außer die Aufgabe verlangt eine andere Sprache), mit dem, was du getan hast und was offen ist.',
].join('\n');

function cut(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… (gekürzt)`;
}

export function memorySection(
  memory: MemoryState | null,
  query = '',
  limit = MEMORY_CHARS,
): string {
  if (!memory) return '';
  const terms = new Set(
    (query.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []).filter(
      (word) => !COMMON_WORDS.has(word),
    ),
  );
  const sources = [
    ...memory.files.map((file) => ({ title: file.file, content: file.content })),
    ...memory.notes.map((note) => ({ title: `notes/${note.day}.md`, content: note.content })),
  ];
  const matches = sources
    .flatMap(({ title, content }) =>
      content
        .split(/\n+/)
        .filter((line) => line.trim())
        .map((line) => {
          const words = new Set(line.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []);
          const score = [...terms].filter((term) => words.has(term)).length;
          return { title, line, score };
        }),
    )
    .filter((entry) => !query.trim() || entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (matches.length === 0) return '';
  const parts: string[] = [];
  let remaining = limit - 120;
  for (const { title, line } of matches) {
    if (remaining <= 0) break;
    const part = `### ${title}\n${line.trim()}`.slice(0, remaining);
    parts.push(part);
    remaining -= part.length + 2;
  }
  return `## Relevant memory excerpts\n${parts.join('\n\n')}\nUse memory with a query for other details.`;
}

export function skillIndex(skills: SkillEntry[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map(
    (skill) => `- ${skill.name}: ${skill.description.replace(/\s+/g, ' ').slice(0, 240)}`,
  );
  return `## Deine Skills (erst mit load_skill laden)\n${lines.join('\n')}`;
}

export function buildSystemPrompt(input: {
  instructions?: string;
  runContext?: string;
  memory: MemoryState | null;
  query?: string;
  skills: SkillEntry[];
  serverInstructions: { server: string; text: string }[];
  workdir: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const sections = [
    input.instructions?.trim() ?? '',
    input.runContext?.trim() ?? '',
    RULES,
    `Arbeitsordner: ${input.workdir}\nHeute: ${now.toISOString().slice(0, 10)}`,
    memorySection(input.memory, input.query),
    skillIndex(input.skills),
    ...input.serverInstructions.map(
      (entry) => `## Hinweise zu ${entry.server}\n${cut(entry.text.trim(), 6000)}`,
    ),
  ];
  return sections.filter(Boolean).join('\n\n');
}
