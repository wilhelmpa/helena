const PRODUCT_CONTEXT =
  /(?:\b(?:Master-Agent von|(?:Agent|agent|Aufgaben|Arbeite|work|runs|tools) in|hier bei|outside|through) Helena\b(?![ \t]+[\p{Lu}][\p{L}]+)|\bHelena(?=['’]s\s+(?:tools|paper limits|hard checks|own|Autopilot|runtime|agents|database|policy|gateway|Inbox|skills|orders|MCP))|\bHelena(?=,\s+der Home-Agent)|\bHelenas(?=\s+(?:Werkzeuge|lokaler Laufzeit|Entscheidungsfunktion))|\bHelena(?=-(?:Werkzeuge|Team|Aufgaben|Wissen|Ziele|Routinen|Projekt|Oberfläche|Repo|UI-Standard))|\bHelena(?=\s+(?:MCP|prüft|sperrt|liest|lehnt|startet|zeigt|stellt|ergänzt|storniert|gleicht|constructs|checks|refuses|trades|sends|starts|keeps|reads))|Produktname (?:ist nur|nur)\s+\*{0,2}Helena\b)/gu;

export interface ProductNameChange {
  field: string;
  before: string;
  after: string;
}

export interface StoredAgentTexts {
  instructions: string | null;
  heartbeatInstructions: string;
  runtimePolicy: unknown;
}

export function migrateAgentTexts(input: StoredAgentTexts): {
  value: StoredAgentTexts;
  changes: ProductNameChange[];
} {
  const changes: ProductNameChange[] = [];
  const replace = (text: string, field: string) =>
    text.replace(PRODUCT_CONTEXT, (before) => {
      const after = before.replace(/\bHelena(?=s?\b)/, '{appName}');
      changes.push({ field, before, after });
      return after;
    });
  const policy = input.runtimePolicy;
  let runtimePolicy = policy;
  if (policy && typeof policy === 'object' && 'files' in policy && Array.isArray(policy.files)) {
    runtimePolicy = {
      ...policy,
      files: policy.files.map((file: unknown, index: number) => {
        if (!file || typeof file !== 'object') return file;
        const entry = file as Record<string, unknown>;
        if (
          typeof entry.path !== 'string' ||
          !/(^|\/)(SOUL|AGENTS)\.md$/.test(entry.path) ||
          typeof entry.content !== 'string'
        )
          return file;
        return {
          ...entry,
          content: replace(entry.content, `runtimePolicy.files[${index}].content (${entry.path})`),
        };
      }),
    };
  }
  return {
    value: {
      instructions:
        input.instructions === null ? null : replace(input.instructions, 'instructions'),
      heartbeatInstructions: replace(input.heartbeatInstructions, 'heartbeatInstructions'),
      runtimePolicy,
    },
    changes,
  };
}
