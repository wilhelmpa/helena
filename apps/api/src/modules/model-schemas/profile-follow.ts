import { parseLocalModelId } from '@helena/sdk';
import { HttpError } from '#shared/lib';
import { LOCAL_PROFILES, type LocalProfile } from '#modules/local-ai/npu-profile';
import { LOCAL_DEFAULT } from '#modules/local-ai/maintenance-state';
import {
  applyMatrix,
  inventory,
  previewMatrix,
  readModelState,
  resolveRow,
  type MatrixPatch,
} from './service';
import { LOCAL_PROFILE_TEMPLATES, PROFILE_SCHEMAS } from './templates';

// A switch of the local profile (Flash on Halogen <-> Qwen3.8-27B with the NPU) carries the
// schemas with it:
//   - A local active schema (the built-in one of a profile) becomes the one of the new profile,
//     and so does a project that follows one of them. The schema of the new profile is made to
//     say that profile, should someone have given it the other one. Mixed, cloud and own schemas stay: their
//     local roles use `volition-local-default`, which is the model that is loaded now.
//   - An agent that pinned the model of a profile by name (the loaded model of the one before)
//     would keep waiting for a model that is not loaded any more. Its pin becomes the local
//     default, which follows every switch. Pins of other models and of cloud runtimes stay.
// It goes through the same preview/apply as every matrix change: audit, revision, undo.

const PROFILE_MODELS = new Set<string>(LOCAL_PROFILES.map((profile) => profile.model));

export type ProjectSchemaFollow = { projectId: number; from: string; to: string };

export function isProfilePin(model: unknown): boolean {
  if (typeof model !== 'string') return false;
  const parsed = parseLocalModelId(model);
  return !!parsed && PROFILE_MODELS.has(parsed.model);
}

export async function profileFollowPatch(profile: LocalProfile): Promise<{
  patch: MatrixPatch;
  from: string;
  to: string;
  projects: ProjectSchemaFollow[];
  empty: boolean;
}> {
  const state = await readModelState();
  const paired = Object.values(PROFILE_SCHEMAS);
  const wanted = PROFILE_SCHEMAS[profile];
  if (!wanted || !state.schemas[wanted]) throw new HttpError(400, 'Unknown local profile');
  const patch: MatrixPatch = { expectedRevision: state.revision };
  if (paired.includes(state.active) && state.active !== wanted) patch.active = wanted;
  const projects = Object.entries(state.projects)
    .filter(([, schemaId]) => paired.includes(schemaId) && schemaId !== wanted)
    .map(([projectId]) => ({ projectId: Number(projectId), schemaId: wanted }));
  if (projects.length) patch.projects = projects;
  // The schema of the profile says that profile (someone may have given it the other one).
  const definition = LOCAL_PROFILE_TEMPLATES.find((entry) => entry.id === profile)!;
  const schema = state.schemas[wanted]!;
  if (schema.profile !== profile)
    patch.schema = {
      ...schema,
      profile,
      classes: definition.classes,
      npuSlots: definition.npuSlots,
      gpuSlots: definition.gpuSlots,
      speechRecognition: definition.speechRecognition,
    };
  const { agents, memberships } = await inventory();
  const changes: NonNullable<MatrixPatch['agents']> = [];
  for (const agent of agents) {
    if (!isProfilePin(agent.modelOverrides?.model)) continue;
    const { model: _pin, ...rest } = agent.modelOverrides;
    const own = resolveRow(agent, memberships, state).cells;
    if (!['helena', 'hermes'].includes(own.runtime.value)) continue;
    // Without its pin the agent follows its schema; where the schema names a different model
    // (a cloud role with a local runtime of its own) the pin becomes the local default.
    const base = resolveRow({ ...agent, modelOverrides: rest }, memberships, state).cells.model
      .value;
    changes.push({
      agentId: agent.id,
      values: { model: base === LOCAL_DEFAULT ? null : LOCAL_DEFAULT },
    });
  }
  if (changes.length) patch.agents = changes;
  return {
    patch,
    from: state.active,
    to: patch.active ?? state.active,
    projects: projects.map(({ projectId }) => ({
      projectId,
      from: state.projects[projectId]!,
      to: wanted,
    })),
    empty: !patch.active && !patch.projects && !patch.agents && !patch.schema,
  };
}

// Applies it (or only previews it: `applied` is false then), once more when the revision moved between reading and writing.
export async function followLocalProfile(
  profile: LocalProfile,
  options: { dryRun?: boolean; actorId?: string | null } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    const { patch, from, to, projects, empty } = await profileFollowPatch(profile);
    if (empty) return { changed: false, applied: false, from, to, projects, preview: null };
    try {
      const preview = options.dryRun
        ? await previewMatrix(patch)
        : await applyMatrix(patch, options.actorId ?? null, 'profile-follow');
      return { changed: true, applied: !options.dryRun, from, to, projects, preview };
    } catch (error) {
      if (attempt > 0 || !(error instanceof HttpError) || error.status !== 409) throw error;
    }
  }
}

// Restore only schema assignments that still match this switch's target.
export async function restoreActiveSchema(
  from: string,
  to: string,
  projects: ProjectSchemaFollow[] = [],
): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    const state = await readModelState();
    const patch: MatrixPatch = { expectedRevision: state.revision };
    if (from !== to && state.active === to && state.schemas[from]) patch.active = from;
    const restore = projects
      .filter((entry) => state.projects[entry.projectId] === entry.to && state.schemas[entry.from])
      .map((entry) => ({ projectId: entry.projectId, schemaId: entry.from }));
    if (restore.length) patch.projects = restore;
    if (!patch.active && !patch.projects) return false;
    try {
      await applyMatrix(patch, null, 'profile-follow');
      return true;
    } catch (error) {
      if (attempt > 0 || !(error instanceof HttpError) || error.status !== 409) throw error;
    }
  }
}
