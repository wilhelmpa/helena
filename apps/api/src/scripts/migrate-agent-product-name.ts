import { db, aiAgent } from '@repo/db';
import { eq } from 'drizzle-orm';
import { migrateAgentTexts } from './ava-name-prompts/migration';

const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some((arg) => arg !== '--apply'))
  throw new Error('Usage: migrate-agent-product-name.ts [--apply]');
await db.transaction(async (tx) => {
  const query = tx
    .select({
      id: aiAgent.id,
      instructions: aiAgent.instructions,
      heartbeatInstructions: aiAgent.heartbeatInstructions,
      runtimePolicy: aiAgent.runtimePolicy,
    })
    .from(aiAgent)
    .orderBy(aiAgent.id);
  const agents = await (apply ? query.for('update') : query);
  const plans = agents
    .map((agent) => ({ id: agent.id, ...migrateAgentTexts(agent) }))
    .filter((plan) => plan.changes.length > 0);
  console.log(
    `${apply ? 'APPLY' : 'DRY RUN'}: ${plans.length} agent(s); replacements use the dynamic {appName} template.`,
  );
  for (const plan of plans) {
    for (const change of plan.changes)
      console.log(
        `Agent ${plan.id}, ${change.field}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`,
      );
  }
  if (!apply) {
    console.log('No writes. Run again with --apply to apply this list.');
    return;
  }
  for (const plan of plans) await tx.update(aiAgent).set(plan.value).where(eq(aiAgent.id, plan.id));
  console.log(`Updated ${plans.length} agent(s).`);
});
process.exit(0);
