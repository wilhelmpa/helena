export interface AuditAgent {
  id: number;
  teamId: number;
  name: string;
  username: string;
  template: boolean;
  sourceTemplateId: number | null;
  templateOverrides: string[];
  instructions: string | null;
  skills: { id: number; name: string }[];
  tools: number[];
  allowedSkillIds?: number[] | null;
  runtimePolicy: {
    toolAllow?: string[];
    toolDeny?: string[];
    skillsDisabled?: string[];
    files?: { path: string; kind: string; content: string }[];
  };
  projects: { key: string; instructions: string }[];
  context?: { role?: string; goals?: boolean; workdir?: string };
}

export interface PoolRole {
  name: string;
  skills: string[];
  instructions: string;
}

export function auditAgent(agent: AuditAgent, agents: AuditAgent[], roles: PoolRole[]) {
  const template = agents.find(
    (entry) =>
      entry.id === agent.sourceTemplateId && entry.teamId === agent.teamId && entry.template,
  );
  const roleName = agent.context?.role?.toLowerCase();
  const roleAliases: Record<string, string> = { coordinator: 'planner', koordinator: 'planner' };
  const role =
    roles.find((entry) => entry.name === (template?.username ?? agent.username)) ??
    roles.find((entry) => entry.name === (roleName ? (roleAliases[roleName] ?? roleName) : ''));
  const expected = [
    ...new Set([...(role?.skills ?? []), ...(template?.skills.map((skill) => skill.name) ?? [])]),
  ];
  const actual = new Set(agent.skills.map((skill) => skill.name));
  const disabled = new Set(agent.runtimePolicy.skillsDisabled ?? []);
  const overrides = new Set(agent.templateOverrides);
  const missing = expected.filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.includes(name));
  const addSkills = overrides.has('skills') ? [] : missing.filter((name) => !disabled.has(name));
  const extraTools = agent.tools.filter((id) => !template?.tools.includes(id));
  const extraGrants = (agent.runtimePolicy.toolAllow ?? []).filter(
    (name) => !template?.runtimePolicy.toolAllow?.includes(name),
  );
  const missingTools = template?.tools.filter((id) => !agent.tools.includes(id)) ?? [];
  const addTools = overrides.has('tools') || overrides.has('approvals') ? [] : missingTools;
  const allow = new Set(agent.runtimePolicy.toolAllow ?? []);
  const deny = new Set(agent.runtimePolicy.toolDeny ?? []);
  const missingGrants = (template?.runtimePolicy.toolAllow ?? []).filter(
    (name) => !allow.has(name),
  );
  const addGrants = overrides.has('approvals')
    ? []
    : missingGrants.filter((name) => !deny.has(name));
  const missingFiles = (template?.runtimePolicy.files ?? []).filter(
    (file) =>
      file.kind === 'instructions' &&
      !agent.runtimePolicy.files?.some((own) => own.path === file.path),
  );
  const addFiles = overrides.has('instructions') ? [] : missingFiles;
  const instructions =
    !agent.instructions?.trim() && !overrides.has('instructions')
      ? template?.instructions || role?.instructions || null
      : null;
  const findings: string[] = [];
  if (!role) findings.push('Pool role unresolved; no role inferred from display name');
  if (!template && !agent.template) findings.push('Source template missing');
  if (!agent.instructions?.trim()) findings.push('Agent instructions missing');
  if (
    template?.instructions &&
    agent.instructions?.trim() &&
    agent.instructions !== template.instructions
  )
    findings.push('Instructions differ; existing content preserved');
  for (const file of template?.runtimePolicy.files ?? []) {
    const own = agent.runtimePolicy.files?.find((entry) => entry.path === file.path);
    if (own && own.content !== file.content) findings.push(`${file.path}: owner content preserved`);
  }
  if (!agent.template) {
    if (!agent.projects.length) findings.push('Project membership missing');
    for (const project of agent.projects)
      if (!project.instructions.trim()) findings.push(`Project ${project.key}: instructions empty`);
    if (!agent.context?.role) findings.push('Role context unverified');
    if (!agent.context?.goals) findings.push('Goals context missing or unverified');
    if (!agent.context?.workdir) findings.push('Working folder missing or unverified');
  }
  return {
    agentId: agent.id,
    agent: agent.name,
    origin: template
      ? `template:${template.id}; pool:${role?.name ?? 'unresolved'}`
      : `pool:${role?.name ?? 'unresolved'}`,
    ownerOverrides: [...overrides],
    missing,
    extra,
    addSkills,
    missingTools,
    extraTools,
    extraGrants,
    addTools,
    missingGrants,
    addGrants,
    missingFiles: missingFiles.map((file) => file.path),
    addFiles,
    instructions,
    findings,
  };
}
