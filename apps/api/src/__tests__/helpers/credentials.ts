import type { Api } from './app';

type CreateBody = Parameters<ReturnType<Api['teams']>['credentials']['post']>[0];

// Stores a credential of the Credentials page on the team that owns a project. Returns
// its id.
export async function createCredentialEntry(
  api: Api,
  projectKey: string,
  body: CreateBody,
): Promise<number> {
  const projects = await api.projects.get();
  const project = projects.data!.find((p) => p.key === projectKey)!;
  const res = await api.teams({ teamId: project.teamId }).credentials.post(body);
  return res.data!.id;
}
