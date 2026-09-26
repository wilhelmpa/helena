// Applies a project blueprint (@helena/sdk blueprints.ts, directory form under blueprints/)
// to the team: the project with its department and instructions, its areas, its agent team
// (copies of the templates the blueprint names), their network rules, the notes, note
// templates and board of its knowledge, its goals, its routines (switched off) and, on
// request, the connector tools bound to the owner's credential. The first blueprint is the
// trading project (blueprints/trading, docs/helena-decisions/trading.md).
//
// Everything is written through Helena's own services (createProject, copyTemplateIntoProject,
// setAgentSkills, setProjectAssignment, setAgentNetwork, writeNote, createGoal, createRoutine,
// createAgentTool …), exactly what the editors in Helena call. Nothing under a Hermes home is
// touched; each changed agent gets a new runtime policy revision and its runner rewrites the
// profile by itself.
//
// Run by the operator, as the API's user with the API's environment, from apps/api:
//
//   bun src/scripts/project-blueprint.ts --blueprint ../../blueprints/trading            # dry run
//   bun src/scripts/project-blueprint.ts --blueprint ../../blueprints/trading --apply    # writes
//   bun src/scripts/project-blueprint.ts --blueprint ../../blueprints/trading --sections=tools --apply
//
// Options: --dry-run (the default), --apply, --sections=project,areas,agents,network,knowledge,
// goals,routines,tools,report (default: all but tools), --team <id> (default: the team of the
// Home agent). Running it again changes nothing that exists: it only adds what is missing and
// reports what differs.

import { resolve } from 'node:path';
import { readBlueprintDir } from '@helena/sdk/blueprints';
import type { ProjectBlueprint } from '@helena/sdk';
import { loadBuiltinPluginsForScripts } from '#modules/project-blueprints/plugins';
import { applyBlueprintPlan } from '#modules/project-blueprints/apply';
import {
  BLUEPRINT_SECTIONS,
  coordinatorHandle,
  DEFAULT_BLUEPRINT_SECTIONS,
  formatPlan,
  planBlueprint,
  type BlueprintPlan,
  type BlueprintSection,
  type BlueprintState,
} from '#modules/project-blueprints/plan';
import { blueprintTeam, loadBlueprintState, teamOwner } from '#modules/project-blueprints/state';
import { blueprintCopyHandle } from '@helena/sdk';

export interface BlueprintOptions {
  blueprint: string | ProjectBlueprint;
  apply?: boolean;
  sections?: BlueprintSection[];
  teamId?: number;
  log?: (line: string) => void;
}

function report(blueprint: ProjectBlueprint, state: BlueprintState): string[] {
  const key = blueprint.project.key;
  const lines: string[] = [];
  if (!state.project) return [`Project ${key} does not exist yet.`];
  lines.push(`Project ${key} "${state.project.name}" (#${state.project.id}).`);
  const handles = [
    coordinatorHandle(key),
    ...blueprint.agents.map((agent) => blueprintCopyHandle(agent.template, key)),
  ];
  for (const handle of handles) {
    const agent = state.agents.find((entry) => entry.username === handle);
    if (!agent) {
      lines.push(`  @${handle}: missing`);
      continue;
    }
    const network = state.network?.agents[String(agent.id)] ?? state.network?.mode ?? 'open';
    lines.push(
      `  @${handle}: ${agent.skills.length} skills, network ${network}` +
        `${agent.projectBrowser ? ', project browser' : ''}` +
        `${agent.tools.length ? `, ${agent.tools.length} configured tools` : ''}` +
        `${agent.memoryApproval ? ', MEMORY APPROVAL ON' : ''}`,
    );
  }
  lines.push(
    `Areas: ${state.areas.map((area) => area.name).join(', ') || 'none'}. ` +
      `Boards: ${state.boards.join(', ') || 'none'}. Routines: ${state.routineKeys.length}.`,
  );
  lines.push(
    `Knowledge files present: ${state.existingFiles.length} of ` +
      `${blueprint.knowledge.project.length + blueprint.knowledge.templates.length}.`,
  );
  for (const connector of Object.keys(state.connectorTools)) {
    const count = state.credentials.filter((entry) => entry.kind === connector).length;
    lines.push(`Credentials of ${connector}: ${count}.`);
  }
  return lines;
}

export async function runProjectBlueprint(options: BlueprintOptions): Promise<BlueprintPlan> {
  const log = options.log ?? console.log;
  const blueprint =
    typeof options.blueprint === 'string'
      ? readBlueprintDir(resolve(options.blueprint))
      : options.blueprint;
  await loadBuiltinPluginsForScripts();
  const teamId = await blueprintTeam(options.teamId);
  const sections = options.sections ?? DEFAULT_BLUEPRINT_SECTIONS;
  const state = await loadBlueprintState(teamId, blueprint);
  const plan = planBlueprint(blueprint, state, sections);
  log(
    `Helena project blueprint ${blueprint.name} ${blueprint.version} — ` +
      `${options.apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}; team ${teamId}; ` +
      `project ${blueprint.project.key}; sections: ${sections.join(', ')}`,
  );
  log('\n== Plan ==');
  const lines = formatPlan(plan);
  for (const line of lines.length ? lines : ['nothing to change']) log(line);
  if (plan.blockers.length > 0) {
    log(`\n${plan.blockers.length} blocker(s): the changes that depend on them are left out.`);
  }
  if (options.apply && plan.changes.length > 0) {
    const ownerUserId = await teamOwner(teamId);
    log('\n== Writing ==');
    const done = await applyBlueprintPlan({ teamId, ownerUserId, blueprint, log }, plan);
    log(`\nApplied ${done} change(s). Routines stay switched off until the owner turns them on.`);
  } else if (!options.apply) {
    log(
      `\nWould apply ${plan.changes.length} change(s), leave ${plan.skipped.length}. ` +
        'Run with --apply to write.',
    );
  }
  if (sections.includes('report')) {
    log('\n== Report ==');
    const after =
      options.apply && plan.changes.length ? await loadBlueprintState(teamId, blueprint) : state;
    for (const line of report(blueprint, after)) log(line);
  }
  return plan;
}

function args(argv: string[]): BlueprintOptions {
  const options: BlueprintOptions = { blueprint: '../../blueprints/trading', apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--blueprint') options.blueprint = String(argv[++i] ?? '');
    else if (arg.startsWith('--sections=')) {
      const names = arg
        .slice('--sections='.length)
        .split(',')
        .map((s) => s.trim());
      for (const name of names) {
        if (!BLUEPRINT_SECTIONS.includes(name as BlueprintSection))
          throw new Error(`Unknown section ${name}`);
      }
      options.sections = names as BlueprintSection[];
    } else if (arg === '--team') options.teamId = Number(argv[++i]);
    else throw new Error(`Unknown argument ${arg}`);
  }
  // --dry-run wins over --apply when both are given.
  if (argv.includes('--dry-run')) options.apply = false;
  return options;
}

if (import.meta.main) {
  await runProjectBlueprint(args(process.argv.slice(2)));
  process.exit(0);
}
