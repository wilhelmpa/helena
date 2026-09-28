// The practice test "Flash als Home" (docs/plan-lokal-halogen.md, Phase 1 point 7): what the
// owner asks Helena's Home agent to set up in a test project, and how the result is checked.
// Pure: the facts to check come from run.ts, read from the (private) database.

// There is no MCP tool for project blueprints (the blueprint CLI needs root provisioning), so
// the "blueprint" is the owner's written spec, as he would give it in the Home chat.
export const SCENARIO = {
  project: { key: 'FLX', name: 'Praxistest Flash' },
  agents: [
    { username: 'praxis-koord', name: 'Koordinator Praxis' },
    { username: 'praxis-recherche', name: 'Recherche Praxis' },
  ],
  goals: ['Kundenzufriedenheit steigern', 'Wöchentlicher Statusbericht'],
  tasks: [
    { title: 'Kundenfeedback der letzten Woche auswerten', delegate: 'praxis-recherche' },
    { title: 'Liste der offenen Supportfälle erstellen', delegate: 'praxis-recherche' },
    { title: 'Wochenplan für das Team schreiben', delegate: 'praxis-koord' },
  ],
  routine: { title: 'Wochenbericht', cron: '0 9 * * 1', agent: 'praxis-koord' },
} as const;

export const HOME_SYSTEM = [
  'Du bist Helena, der Home-Agent des Inhabers. Du arbeitest ausschließlich über die Helena-Werkzeuge.',
  'Arbeite zügig und genau: lies nur, was du brauchst, lege nichts doppelt an, rate keine IDs,',
  'sondern hole sie über die Werkzeuge. Wenn ein Werkzeug einen Fehler meldet, lies die Meldung',
  'und korrigiere den Aufruf. Wenn alles erledigt ist, antworte ohne Werkzeugaufruf mit einem',
  'kurzen Statusbericht auf Deutsch.',
].join('\n');

export function scenarioPrompt(): string {
  const s = SCENARIO;
  return [
    `Bitte richte ein Testprojekt nach dieser Vorlage ein:`,
    `1. Projekt „${s.project.name}“ mit dem Schlüssel ${s.project.key}.`,
    `2. Zwei KI-Agenten (Art: external), beide nur in diesem Projekt: ` +
      s.agents.map((agent) => `„${agent.name}“ (Benutzername ${agent.username})`).join(' und ') +
      '.',
    `3. Zwei Ziele im Projekt: ${s.goals.map((goal) => `„${goal}“`).join(' und ')}.`,
    `4. Drei Aufgaben im Projekt, jeweils an den genannten Agenten delegiert: ` +
      s.tasks.map((task) => `„${task.title}“ → ${task.delegate}`).join('; ') +
      '.',
    `5. Eine Routine „${s.routine.title}“, jeden Montag um 9:00 (Cron „${s.routine.cron}“, ` +
      `Europe/Berlin), die eine Aufgabe für ${s.routine.agent} anlegt.`,
    `6. Prüfe danach die Agentenläufe des Projekts und starte die Routine einmal von Hand.`,
    `7. Schließe mit einem kurzen Statusbericht: was angelegt ist, welche Läufe es gibt, was offen ist.`,
  ].join('\n');
}

// What run.ts reads back after the loop.
export interface ScenarioFacts {
  project: { id: number; key: string; name: string } | null;
  agents: { username: string; name: string; userId: string; projectKeys: string[] }[];
  goals: string[];
  tasks: { title: string; delegateUsername: string | null }[];
  routines: { title: string; cron: string; timezone: string; agentUsername: string | null }[];
  // Runs of the project's agents, and whether a routine fire (run_routine) happened.
  runs: number;
  routineFired: boolean;
}

export interface Check {
  id: string;
  passed: boolean;
  detail: string;
}

const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const same = (a: string, b: string) => norm(a) === norm(b) || norm(a).includes(norm(b));

export function checkScenario(facts: ScenarioFacts, answer: string): Check[] {
  const s = SCENARIO;
  const checks: Check[] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  add(
    'project',
    facts.project?.key === s.project.key && same(facts.project.name, s.project.name),
    facts.project ? `${facts.project.key} „${facts.project.name}“` : 'missing',
  );
  for (const want of s.agents) {
    const agent = facts.agents.find((entry) => entry.username === want.username);
    add(
      `agent:${want.username}`,
      !!agent && same(agent.name, want.name) && agent.projectKeys.includes(s.project.key),
      agent ? `${agent.name} in ${agent.projectKeys.join(',') || 'no project'}` : 'missing',
    );
  }
  // No extra agents beyond the two asked for.
  add(
    'agents:no-extra',
    facts.agents.length === s.agents.length,
    `${facts.agents.length} agents in ${s.project.key}`,
  );
  for (const want of s.goals) {
    add(
      `goal:${want}`,
      facts.goals.some((goal) => same(goal, want)),
      facts.goals.join(' | ') || 'none',
    );
  }
  for (const want of s.tasks) {
    const task = facts.tasks.find((entry) => same(entry.title, want.title));
    add(
      `task:${want.title}`,
      !!task && task.delegateUsername === want.delegate,
      task ? `delegate ${task.delegateUsername ?? 'none'}` : 'missing',
    );
  }
  add(
    'tasks:no-duplicates',
    facts.tasks.length === s.tasks.length,
    `${facts.tasks.length} tasks (routine fires excluded)`,
  );
  const routine = facts.routines.find((entry) => same(entry.title, s.routine.title));
  add(
    'routine',
    !!routine &&
      routine.cron.trim() === s.routine.cron &&
      routine.agentUsername === s.routine.agent,
    routine
      ? `${routine.cron} ${routine.timezone} → ${routine.agentUsername ?? 'none'}`
      : 'missing',
  );
  add('routine:fired', facts.routineFired, facts.routineFired ? 'fired once' : 'not fired');
  const text = norm(answer);
  add(
    'report',
    text.length > 40 && text.includes(norm(s.project.key)) && /routine|wochenbericht/.test(text),
    answer.slice(0, 160).replace(/\s+/g, ' ') || 'no answer',
  );
  return checks;
}
