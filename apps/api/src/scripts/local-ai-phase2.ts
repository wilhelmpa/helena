// Phase 2, step 1 (docs/plan-lokal-halogen.md): the background kinds of work and the decisions
// go to Halogen's model first, each with its cloud fallback (mode `prefer`: the configured model
// answers whenever the local one is off, down, too slow or wrong). A class moves only once its
// eval passed on that model (Helena's own gate, updatePolicy). Dry run by default.
//
//   sudo systemd-run --wait --pipe --collect --uid=volition-plan \
//     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan \
//     /usr/local/bin/bun apps/api/src/scripts/local-ai-phase2.ts [--server halogen] \
//     [--classes triage,routines,…] [--evaluate] [--apply] [--enable]
//
// --evaluate  runs the missing or failed evals one after the other (one request at a time on
//             the server; minutes each), then shows the plan again
// --apply     puts every class whose eval passed in `prefer` on the model; the others stay
// --enable    also turns the master switch on (off: nothing local runs, whatever the classes say)
import { readLocalAiPolicy, modelServerBySlug } from '@repo/db';
import { localModelId } from '@helena/sdk';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '#modules/local-ai/plugin';
import { DECISIONS_LOCAL_AI_CLASS } from '#modules/decisions/local-ai-class';
import {
  classBlocker,
  evalById,
  latestEvals,
  refreshServer,
  startEval,
  taskClass,
  updatePolicy,
} from '#modules/local-ai/service';

// The plan's first step: background work and decisions.
export const PHASE2_CLASSES = [
  'triage',
  'routines',
  'summaries',
  'reflection',
  'decisions',
  'coordinator-triage',
  'hermes-helpers',
  'voice-reply',
] as const;

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? (process.argv[index + 1] ?? null) : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

await host.load(localAiPlugin, {
  id: LOCAL_AI_PLUGIN_ID,
  name: 'Local AI',
  version: '1.0.0',
  sdk: '^0.1.0',
  provides: LOCAL_AI_PROVIDES,
});
// The decisions' class belongs to the decisions plugin, which a script does not load whole.
if (!host.localAiTaskClasses.get(DECISIONS_LOCAL_AI_CLASS.id))
  host.localAiTaskClasses.register(DECISIONS_LOCAL_AI_CLASS);

const slug = argument('server') ?? 'halogen';
const classes = (argument('classes')?.split(',').filter(Boolean) ?? [...PHASE2_CLASSES]).filter(
  (id) => {
    if (taskClass(id)) return true;
    console.error(`unknown class ${id}: skipped`);
    return false;
  },
);
const row = await modelServerBySlug(slug);
if (!row) {
  console.error(`No server ${slug}: register it first (local-ai-register.ts --kind halogen)`);
  process.exit(1);
}
const server = await refreshServer(row.id);
const chat = server.models.find((model) => model.capabilities.includes('chat'));
if (!chat) {
  console.error(`${server.name} lists no chat model (${server.status?.error ?? 'no answer'})`);
  process.exit(1);
}
const modelId = localModelId(server.slug, chat.id);

async function plan() {
  const evals = await latestEvals();
  const policy = await readLocalAiPolicy();
  return classes.map((id) => {
    const entry = taskClass(id)!;
    const blocker = classBlocker(entry, modelId, evals);
    const latest = evals.find((item) => item.classId === id && item.modelId === modelId);
    return {
      id,
      blocker,
      score: latest ? Math.round(latest.score * 100) : null,
      now: policy.classes[id] ?? { mode: 'off', model: null },
    };
  });
}

function show(rows: Awaited<ReturnType<typeof plan>>) {
  console.log(`\n${server.name}: ${modelId} (${server.status?.reachable ? 'answers' : 'DOWN'})`);
  for (const entry of rows) {
    console.log(
      `  ${entry.id.padEnd(20)} now ${entry.now.mode.padEnd(6)} ${(entry.now.model ?? 'auto').padEnd(46)} ` +
        `eval ${entry.score === null ? '–' : `${entry.score} %`}  ${entry.blocker ?? 'ready'}`,
    );
  }
}

let rows = await plan();
show(rows);

if (flag('evaluate')) {
  for (const entry of rows.filter(
    (item) => item.blocker === 'eval-missing' || item.blocker === 'eval-failed',
  )) {
    process.stdout.write(`\neval ${entry.id} on ${modelId} … `);
    const started = await startEval({ classId: entry.id, modelId, userId: null });
    let current = started;
    while (current.status === 'running') {
      await Bun.sleep(5_000);
      current = (await evalById(started.id)) ?? { ...current, status: 'stale' };
    }
    console.log(
      `${current.status} ${Math.round(current.score * 100)} % (threshold ${Math.round(current.threshold * 100)} %)${current.error ? ` ${current.error}` : ''}`,
    );
  }
  rows = await plan();
  show(rows);
}

if (flag('apply')) {
  const ready = rows.filter((entry) => entry.blocker === null);
  if (ready.length > 0) {
    await updatePolicy({
      classes: Object.fromEntries(
        ready.map((entry) => [entry.id, { mode: 'prefer', model: modelId }]),
      ),
    });
  }
  console.log(`\nprefer on ${modelId}: ${ready.map((entry) => entry.id).join(', ') || 'none'}`);
  const held = rows.filter((entry) => entry.blocker !== null);
  if (held.length > 0)
    console.log(
      `unchanged (eval first): ${held.map((entry) => `${entry.id} (${entry.blocker})`).join(', ')}`,
    );
  if (flag('enable')) {
    await updatePolicy({ enabled: true });
    console.log('master switch: on');
  }
} else {
  console.log('\nDry run: nothing changed (--evaluate, --apply, --enable).');
}
process.exit(0);
