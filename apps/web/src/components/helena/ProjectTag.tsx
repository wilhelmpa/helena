export function ProjectTag({ projectKey, plain = false }: { projectKey: string; plain?: boolean }) {
  return (
    <span
      className={`helena-project-tag font-mono text-[10px] font-medium ${plain ? 'px-0 py-0' : 'rounded px-1.5 py-0.5'}`}
      data-project={projectKey.toUpperCase()}
      style={plain ? { background: 'transparent' } : undefined}
    >
      {projectKey}
    </span>
  );
}
