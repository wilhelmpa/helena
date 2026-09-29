export const BRIDGES = {
  de: ['Ich schau kurz nach.', 'Einen Augenblick, ich prüfe das.', 'Gute Frage, ich sehe nach.'],
  en: ["I'll check that for you.", 'Let me take a look.', 'Good question, I will check.'],
} as const;

// One mapping for stream tool names and both spoken languages.
export const TOOL_UPDATES = [
  {
    matches: /mail|email|inbox|outlook|gmail/i,
    de: 'Ich lese deine Mails.',
    en: "I'm checking your emails.",
  },
  {
    matches: /browser|web|search|fetch|url|page/i,
    de: 'Ich öffne den Browser.',
    en: "I'm opening the browser.",
  },
  {
    matches: /task|todo|issue|linear|ticket/i,
    de: 'Ich lege die Aufgabe an.',
    en: "I'm creating the task.",
  },
  {
    matches: /calendar|event|schedule/i,
    de: 'Ich prüfe deinen Kalender.',
    en: "I'm checking your calendar.",
  },
  {
    matches: /file|document|drive|dropbox|box|sharepoint/i,
    de: 'Ich lese das Dokument.',
    en: "I'm reading the document.",
  },
  {
    matches: /terminal|shell|exec|code/i,
    de: 'Ich prüfe das gerade.',
    en: "I'm checking that now.",
  },
  { matches: /.*/, de: 'Ich arbeite noch daran.', en: "I'm still working on it." },
] as const;

export function spokenLanguage(language: string): 'de' | 'en' {
  return language === 'de' ? 'de' : 'en';
}

export function toolUpdate(tool: string, language: string): string {
  const phrase = TOOL_UPDATES.find((row) => row.matches.test(tool))!;
  return phrase[spokenLanguage(language)];
}

export function preloadedPhrases(language: string): string[] {
  const lang = spokenLanguage(language);
  return [...BRIDGES[lang], ...new Set(TOOL_UPDATES.map((row) => row[lang]))];
}
