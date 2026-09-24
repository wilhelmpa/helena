'use client';

import LocalAiSettingsView from '@/features/local-ai/components/LocalAiSettingsView';
import GodSectionPage from './components/GodSectionPage';

// Administrator → Lokale KI (docs/helena-decisions/local-ai-platform.md). Until the Server area
// (hub/server-admin) mounts the same view as its own tab, it has a section of its own.
export default function GodLocalAiPage() {
  return (
    <GodSectionPage slug="local-ai">
      <LocalAiSettingsView />
    </GodSectionPage>
  );
}
