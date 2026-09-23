import PipelineEditorPage from '@/features/pipelines/PipelineEditorPage';

export default async function Page({ params }: { params: Promise<{ pipelineId: string }> }) {
  const { pipelineId } = await params;
  return <PipelineEditorPage pipelineId={Number(pipelineId)} />;
}
