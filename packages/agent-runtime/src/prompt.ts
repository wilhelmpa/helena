import type { SkillEntry } from './config';
import type { MemoryState } from './helena-client';

// The system prompt of a command: the agent's standing instructions (its SOUL in Helena), the
// run's own context the runner hands over, the loop's working rules, the memory Helena keeps
// for the agent, the index of its skills and what its tool servers say about their use.

const MEMORY_CHARS = 12_000;
const NOTE_CHARS = 3_000;

const RULES = [
  '## Arbeitsweise',
  '- Du arbeitest selbständig mit deinen Werkzeugen, bis die Aufgabe erledigt ist. Rufe Werkzeuge direkt auf; erfinde keine Ergebnisse.',
  '- Wenn ein Werkzeug fehlt, suche es mit find_tools. Wenn eine Aufgabe zu einem deiner Skills passt, lade ihn zuerst mit load_skill.',
  '- Ein Werkzeug, das "BLOCKED" antwortet, darfst du nicht auf anderem Weg umgehen. Beende dann den Zug und nenne den Grund.',
  '- Wiederhole keinen Aufruf, der nichts geändert hat. Wenn du feststeckst, sag es.',
  '- Frag nur mit clarify nach, wenn es ohne die Antwort nicht weitergeht.',
  '- Am Ende: eine kurze, klare Antwort auf Deutsch (außer die Aufgabe verlangt eine andere Sprache), mit dem, was du getan hast und was offen ist.',
].join('\n');

function cut(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… (gekürzt)`;
}

export function memorySection(memory: MemoryState | null): string {
  if (!memory) return '';
  const parts: string[] = [];
  for (const file of memory.files) {
    if (file.content.trim())
      parts.push(`### ${file.file}\n${cut(file.content.trim(), MEMORY_CHARS)}`);
  }
  for (const note of memory.notes) {
    if (note.content.trim())
      parts.push(`### Notiz ${note.day}\n${cut(note.content.trim(), NOTE_CHARS)}`);
  }
  if (parts.length === 0) return '';
  return `## Dein Gedächtnis\n${parts.join('\n\n')}`;
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
    memorySection(input.memory),
    skillIndex(input.skills),
    ...input.serverInstructions.map(
      (entry) => `## Hinweise zu ${entry.server}\n${cut(entry.text.trim(), 6000)}`,
    ),
  ];
  return sections.filter(Boolean).join('\n\n');
}
