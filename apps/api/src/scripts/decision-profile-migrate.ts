import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { runVolitionScript } from '../../../../scripts/volition-script-runtime';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  availableModel,
  decisionProfile,
  DECISION_THRESHOLDS,
  LOCAL_ONLY_CLASSES,
} from './decision-profile';

const CREDENTIAL_ID = 36;
const JEV_ID = 46;
const STAGE_KEY = (teamId: number) => `decisions.jev-first-stage.team.${teamId}`;
const POLICY_KEY = 'localAi.policy';

export async function migrateDecisionProfile(apply = false, progress = (_message: string) => {}) {
  const {
    appSetting,
    db,
    forgetSetting,
    helenaDecisionClassSetting,
    helenaDecisionEval,
    helenaModelServer,
    integrationCredential,
  } = await import('@repo/db');
  progress('Reading decision connections 36 and 46.');
  const credentials = await db
    .select({
      id: integrationCredential.id,
      teamId: integrationCredential.teamId,
      projectId: integrationCredential.projectId,
      integrationKey: integrationCredential.integrationKey,
      redacted: integrationCredential.redacted,
    })
    .from(integrationCredential)
    .where(inArray(integrationCredential.id, [CREDENTIAL_ID, JEV_ID]));
  const local = credentials.find((row) => row.id === CREDENTIAL_ID);
  const jev = credentials.find((row) => row.id === JEV_ID);
  if (
    !local ||
    !jev ||
    local.teamId !== jev.teamId ||
    local.projectId !== null ||
    jev.projectId !== null ||
    local.integrationKey !== 'decision_model' ||
    jev.integrationKey !== 'decision_model'
  )
    throw new Error('Expected team-wide decision connections 36 and 46 in the same team.');
  const localFields = local.redacted as Record<string, unknown>;
  const jevFields = jev.redacted as Record<string, unknown>;
  if (
    localFields.provider !== 'local-logit' ||
    !['typesafe', 'vercel'].includes(String(jevFields.provider))
  )
    throw new Error(
      'Decision connection providers do not match the expected local-logit and Jev types.',
    );
  progress('Reading stored model server availability.');
  const servers = await db
    .select()
    .from(helenaModelServer)
    .where(inArray(helenaModelServer.slug, ['halogen', 'npu']));
  const halogen = servers.find((row) => row.slug === 'halogen');
  if (!halogen?.enabled) throw new Error('An enabled Halogen model server is required.');
  const halogenModel = availableModel(halogen.slug, halogen.models);
  if (!halogenModel) throw new Error('Halogen has no available chat model.');
  const npu = servers.find((row) => row.slug === 'npu');
  const npuModel =
    npu?.enabled &&
    npu.status?.reachable &&
    npu.checkedAt &&
    Date.now() - npu.checkedAt.getTime() < 10 * 60_000
      ? availableModel(npu.slug, npu.models)
      : null;
  progress('Reading decision settings and local AI policy.');
  const [settings, classes] = await Promise.all([
    db
      .select()
      .from(appSetting)
      .where(inArray(appSetting.key, [STAGE_KEY(local.teamId), POLICY_KEY])),
    db
      .select()
      .from(helenaDecisionClassSetting)
      .where(eq(helenaDecisionClassSetting.teamId, local.teamId)),
  ]);
  const stage = (settings.find((row) => row.key === STAGE_KEY(local.teamId))?.value ??
    null) as Record<string, unknown> | null;
  const policy = (settings.find((row) => row.key === POLICY_KEY)?.value ?? null) as Record<
    string,
    unknown
  > | null;
  const planned = decisionProfile(
    Object.fromEntries(classes.map((row) => [row.classId, row])),
    stage,
    policy,
    halogenModel,
    npuModel,
  );
  planned.localPolicy.enabled = true;
  planned.localPolicy.units = {
    ...(policy?.units as Record<string, unknown> | undefined),
    gpu: true,
  };
  const connection = {
    ...localFields,
    baseUrl: halogen.baseUrl,
    model: halogenModel.slice(`helena-${halogen.slug}/`.length),
    modelServer: halogen.slug,
    keySource: 'local-ai',
    allowPrivateAddress: true,
  };
  const changes = {
    connection: !isDeepStrictEqual(connection, localFields),
    stage: !isDeepStrictEqual({ ...planned.stage, revision: stage?.revision ?? null }, stage),
    policy: !isDeepStrictEqual(planned.localPolicy, policy),
    classes: Object.entries(planned.classSettings)
      .filter(([id, next]) => {
        const current = classes.find((row) => row.classId === id);
        return (
          !current ||
          Object.entries(next).some(
            ([key, value]) => current[key as keyof typeof current] !== value,
          )
        );
      })
      .map(([id]) => id),
  };
  progress('Reading decision evaluation results.');
  const evaluations = await db
    .select({
      classId: helenaDecisionEval.classId,
      credentialId: helenaDecisionEval.credentialId,
      model: helenaDecisionEval.model,
      threshold: helenaDecisionEval.threshold,
      passed: helenaDecisionEval.passed,
      finishedAt: helenaDecisionEval.finishedAt,
    })
    .from(helenaDecisionEval)
    .where(
      and(
        eq(helenaDecisionEval.teamId, local.teamId),
        inArray(helenaDecisionEval.credentialId, [CREDENTIAL_ID, JEV_ID]),
      ),
    )
    .orderBy(desc(helenaDecisionEval.createdAt), desc(helenaDecisionEval.id));
  const needsEval = (credentialId: number, thresholds: Record<string, number>, model?: string) =>
    Object.entries(thresholds)
      .filter(([classId, threshold]) => {
        const latest = evaluations.find(
          (entry) => entry.credentialId === credentialId && entry.classId === classId,
        );
        return (
          !latest?.passed ||
          !latest.finishedAt ||
          latest.threshold > threshold ||
          (model !== undefined && latest.model !== model)
        );
      })
      .map(([classId]) => classId);
  const pendingEvals = {
    jev: needsEval(JEV_ID, DECISION_THRESHOLDS),
    flash: needsEval(
      CREDENTIAL_ID,
      { ...DECISION_THRESHOLDS, ...LOCAL_ONLY_CLASSES },
      connection.model as string,
    ),
  };
  if (apply) {
    progress('Applying decision profile changes in a transaction.');
    await db.transaction(async (tx) => {
      if (changes.connection)
        await tx
          .update(integrationCredential)
          .set({ redacted: connection, updatedAt: new Date() })
          .where(
            and(
              eq(integrationCredential.id, CREDENTIAL_ID),
              eq(integrationCredential.teamId, local.teamId),
            ),
          );
      if (changes.policy)
        await tx
          .insert(appSetting)
          .values({ key: POLICY_KEY, value: planned.localPolicy })
          .onConflictDoUpdate({
            target: appSetting.key,
            set: { value: planned.localPolicy, updatedAt: new Date() },
          });
      if (changes.stage) {
        const value = { ...planned.stage, revision: randomUUID() };
        await tx
          .insert(appSetting)
          .values({ key: STAGE_KEY(local.teamId), value })
          .onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } });
      }
      for (const id of changes.classes) {
        const next = planned.classSettings[id]!;
        await tx
          .insert(helenaDecisionClassSetting)
          .values({ teamId: local.teamId, classId: id, ...next })
          .onConflictDoUpdate({
            target: [helenaDecisionClassSetting.teamId, helenaDecisionClassSetting.classId],
            set: { ...next, updatedAt: new Date() },
          });
      }
    });
    if (changes.policy) await forgetSetting(POLICY_KEY);
    if (changes.stage) await forgetSetting(STAGE_KEY(local.teamId));
  }
  return { teamId: local.teamId, apply, halogenModel, npuModel, changes, pendingEvals };
}

if (import.meta.main) {
  await runVolitionScript(
    'decision-profile-migrate',
    process.argv.includes('--apply'),
    async ({ progress, onClose }) => {
      if (process.argv.slice(2).some((arg) => arg !== '--apply'))
        throw new Error('Usage: bun apps/api/src/scripts/decision-profile-migrate.ts [--apply]');
      progress('Loading database modules.');
      const { closeDatabase } = await import('@repo/db');
      onClose(closeDatabase);
      console.log(
        JSON.stringify(
          await migrateDecisionProfile(process.argv.includes('--apply'), progress),
          null,
          2,
        ),
      );
    },
  );
}
