'use client';

import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import GodSectionPage from './components/GodSectionPage';
import GodGeneralForm from './components/GodGeneralForm';
import {
  useEngineSettingsAdminQuery,
  useInstanceProjectDefaultsQuery,
  useInstanceRunResumeSettingsQuery,
} from './services/god.service';

export default function GodGeneralPage() {
  const projectDefaults = useInstanceProjectDefaultsQuery();
  const runResume = useInstanceRunResumeSettingsQuery();
  const engine = useEngineSettingsAdminQuery();

  if (!projectDefaults.data || !runResume.data || !engine.data) {
    return (
      <GodSectionPage slug="general">
        <ListSkeleton rows={5} rowClassName="h-12" />
      </GodSectionPage>
    );
  }
  return (
    <GodGeneralForm
      key={JSON.stringify(projectDefaults.data) + JSON.stringify(runResume.data)}
      defaults={projectDefaults.data}
      runResume={runResume.data}
      engine={engine.data}
    />
  );
}
