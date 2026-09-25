'use client';

import LocalAiCard from './LocalAiCard';

// Administrator → Server → Übersicht: local AI's units, loaded models and switches, as a section
// below the machine's own (extensions/serverSections). The Server tab frames it, so the card
// drops its own frame; the health lines of its servers come from the `local-ai` host capability.
export default function LocalAiServerSection() {
  return <LocalAiCard className="border-0 bg-transparent p-0" />;
}
