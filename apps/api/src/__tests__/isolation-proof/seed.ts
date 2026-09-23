import { writeFileSync } from 'node:fs';
import { auth } from '@repo/auth';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { bootstrapHomeAgent } from '../../scripts/bootstrap-home-agent';

// Seeds the Plan API the isolation proof tests run against (deployment/volition-stack/
// isolation/proof): an owner, the projects ALPHA and BETA with an agent each, the Home agent
// and a personal key of the owner. Writes the keys to the file named on the command line.
// resetDb refuses anything but a test database.

const out = process.argv[2];
if (!out) throw new Error('usage: bun seed.ts <keys.json>');

await resetDb();
const owner = await signUpTestUser({ name: 'Owner', email: 'owner@isolation.test' });
const asOwner = authedApi(owner.cookie);
const home = await bootstrapHomeAgent();
if (home.status !== 'ready') throw new Error('Home agent was not provisioned');
const projects: Record<string, number> = {};
for (const key of ['ALPHA', 'BETA']) {
  const created = await asOwner.projects.post({ key, name: key.toLowerCase() });
  projects[key] = created.data!.id;
}
const alpha = await createAgent(asOwner, 'ALPHA', {
  name: 'Alpha Bot',
  username: 'alphabot',
  kind: 'external',
  triggerOnMention: true,
});
const beta = await createAgent(asOwner, 'BETA', {
  name: 'Beta Bot',
  username: 'betabot',
  kind: 'external',
  triggerOnMention: true,
});
const personal = await auth.api.createApiKey({ body: { userId: owner.userId, name: 'proof' } });
const view = await asOwner.projects({ projectKey: 'ALPHA' }).get();
// A run for the end-to-end test: the owner mentions the agent on an issue of ALPHA.
const issue = (
  await asOwner
    .projects({ projectKey: 'ALPHA' })
    .issues.post({ columnId: view.data!.columns[0].id, title: 'Isolation proof' })
).data!;
await asOwner
  .issues({ issueId: issue.id })
  .comments.post({ body: `@alphabot write the proof files` });
const check = await apiKeyApi(alpha.data!.apiKey!).me.get();

writeFileSync(
  out,
  `${JSON.stringify(
    {
      ownerCookie: owner.cookie,
      ownerKey: personal.key,
      alphaKey: alpha.data!.apiKey,
      alphaAgentId: alpha.data!.agent.id,
      betaKey: beta.data!.apiKey,
      betaAgentId: beta.data!.agent.id,
      homeKey: home.apiKey,
      homeAgentId: home.agentId,
      projects,
      issueId: issue.id,
      alphaUser: (check.data as { user?: { id?: string } } | undefined)?.user?.id ?? null,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(`seeded: projects ${Object.keys(projects).join(', ')}`);
process.exit(0);
