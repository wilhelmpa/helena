// The owner-approved steps of the first pool plan (docs/volition-agent-pool-research.md,
// sections C and E) that change running agents or projects. setup-agent-pool.ts runs
// them only when named in --sections (copies, org, goals); the default run touches the
// pool (skills and templates) only.

// Project copies that close the gaps of research section C. VOL stands in for
// "Volition"/"team-weit": there is no project row for the company or for Home. Moving a
// copy later is one project change in the agent editor.
export const COPIES: { template: string; projectKey: string }[] = [
  { template: 'content', projectKey: 'VERVE' },
  { template: 'qa', projectKey: 'VOL' },
  { template: 'qa', projectKey: 'VERVE' },
  { template: 'assistant', projectKey: 'FAM' },
  { template: 'assistant', projectKey: 'PRIV' },
  { template: 'finance', projectKey: 'PRIV' },
  { template: 'finance', projectKey: 'VOL' },
  { template: 'researcher', projectKey: 'VOL' },
];

// Research section B #2: what every project coordinator should have (all from
// obra/superpowers, already in the library). Added, never removed.
export const COORDINATOR_SKILLS = [
  'brainstorming',
  'dispatching-parallel-agents',
  'writing-plans',
  'receiving-code-review',
  'requesting-code-review',
  'verification-before-completion',
];

export const ROADMAP_GOALS: { title: string; description: string }[] = [
  {
    title: 'Phase 0 — Fundament: Sicherheit, natives Hosting, Backup',
    description:
      'kingston ist sicher, lokal vollständig nativ erreichbar, gesichert und reproduzierbar; ' +
      'der Internetzugang ist vorbereitet.',
  },
  {
    title: 'Phase 1 — Projekt-Lebenszyklus und Secrets',
    description:
      'Ein neues Projekt richtet alles ein, ein gelöschtes entfernt alles; ein Speicher für ' +
      'Maschinen-Secrets statt acht.',
  },
  {
    title: 'Phase 2 — Arbeitsplatz: Navigation, Panel, Terminal, Browser',
    description:
      'Eine Navigation, ein geteiltes Werkzeug-Panel, echte Terminal-Tabs, ein reparierter Browser.',
  },
  {
    title: 'Phase 3 — Hermes vollständig integrieren',
    description:
      'Chat mit Kontext, Freigaben und Rückfragen; eine Agent-Seite statt vier; Hermes als einzige Laufzeit.',
  },
  {
    title: 'Phase 4 — Orga, Orchestrierung, wiederkehrende Aufgaben',
    description:
      'Org-Chart als echte Grafik, agent-team sichtbar und steuerbar, Mastra als einziger ' +
      'Scheduler für fachliche Aufgaben.',
  },
  {
    title: 'Phase 5 — Mail',
    description:
      'IMAP/SMTP, ein schneller Posteingang, Compose im geteilten Panel, Agenten schreiben nur Entwürfe.',
  },
  {
    title: 'Phase 6 — Planung: Bereiche, Projekt-Einstellungen, Home',
    description:
      'Bereiche mit eigenen Boards, Einstellungen strikt pro Projekt, Home als konsolidierte Übersicht.',
  },
];
