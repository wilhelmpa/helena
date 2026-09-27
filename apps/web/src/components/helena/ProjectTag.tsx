export function ProjectTag({ projectKey }: { projectKey: string }) {
  return (
    <span
      className="helena-project-tag rounded px-1.5 py-0.5 font-mono text-[10px] font-medium"
      data-project={projectKey.toUpperCase()}
    >
      {projectKey}
    </span>
  );
}
