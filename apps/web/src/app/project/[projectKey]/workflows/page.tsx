import WorkflowsPage from '@/features/settings/SettingsWorkflowsPage';
import ProjectPipelinesPanel from '@/features/pipelines/ProjectPipelinesPanel';

// The project's Workflows page: the Mastra workflows and templates of the settings
// feature, with the workflow builder's panel placed first.
export default function Page() {
  return <WorkflowsPage builder={<ProjectPipelinesPanel />} />;
}
