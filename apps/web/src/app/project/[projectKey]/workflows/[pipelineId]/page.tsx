import PipelineEditorPage from '@/features/pipelines/PipelineEditorPage';

export default async function Page({
  params,
}: {
  params: Promise<{ projectKey: string; pipelineId: string }>;
}) {
  const { projectKey, pipelineId } = await params;
  return <PipelineEditorPage pipelineId={Number(pipelineId)} projectKey={projectKey} />;
}
