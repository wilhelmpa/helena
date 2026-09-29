// Renames the default data older versions created in English (a project's states, issue
// types, board and list views, its coordinator's display name and its Blocked label, a
// team's default role) into the language of the project's or team's owner, as a new
// project gets them now (@helena/locales/defaults). Run once by the operator after the
// owner agreed:
//
//   bun --env-file=<api env> src/scripts/localize-default-names.ts              # dry run
//   bun --env-file=<api env> src/scripts/localize-default-names.ts --apply
//
// Options: --dry-run (the default: prints what it would rename, writes nothing), --apply
// (renames, in one transaction), --locale <de|en|…> (one language for everything instead
// of each owner's), --project <KEY> (only these projects and their teams; repeatable).
//
// Only a name that is still exactly the English default is renamed; anything a person
// renamed is theirs and stays. A rename that would clash with a name the project already
// has is skipped and reported. Running it again renames nothing, since no English default
// is left.

import {
  aiAgent,
  db,
  issueType,
  label,
  project,
  projectColumn,
  projectView,
  team,
  teamMember,
  teamRole,
  user,
  userPreference,
} from '@repo/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { projectCoordinatorUsername } from '@repo/agent-naming';
import {
  DEFAULT_STATES,
  DEFAULT_VIEWS,
  coordinatorName,
  defaultNames,
  type IssueTypeKey,
} from '@helena/locales/defaults';
import { isLocale, toLocale, type Locale } from '#modules/user-preferences/locale';
import { projectLocale } from '#modules/user-preferences/service';

const ENGLISH = defaultNames('en');

export interface Rename {
  kind: 'state' | 'issueType' | 'view' | 'coordinator' | 'label' | 'role';
  id: number | string;
  // The project key, or the team name for a role.
  scope: string;
  from: string;
  to: string;
  // Why it is left alone, when it is.
  skipped?: string;
}

export interface LocalizeOptions {
  apply?: boolean;
  locale?: Locale;
  projectKeys?: string[];
  log?: (line: string) => void;
}

const lower = (name: string) => name.trim().toLowerCase();

// A rename unless the scope already has the target name (another row than this one).
function rename(
  kind: Rename['kind'],
  row: { id: number | string; name: string },
  to: string,
  scope: string,
  taken: string[],
): Rename | null {
  if (row.name === to) return null;
  const clash = taken.some((name) => lower(name) === lower(to) && name !== row.name);
  return {
    kind,
    id: row.id,
    scope,
    from: row.name,
    to,
    ...(clash ? { skipped: 'name taken' } : {}),
  };
}

async function teamOwnerLocale(teamId: number): Promise<Locale> {
  const [row] = await db
    .select({ locale: userPreference.locale })
    .from(teamMember)
    .leftJoin(userPreference, eq(userPreference.userId, teamMember.userId))
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, 'owner')))
    .orderBy(asc(teamMember.createdAt))
    .limit(1);
  return toLocale(row?.locale);
}

export async function planDefaultNameLocalization(
  options: Pick<LocalizeOptions, 'locale' | 'projectKeys'> = {},
): Promise<Rename[]> {
  const projects = await db
    .select({ id: project.id, key: project.key, teamId: project.teamId })
    .from(project)
    .where(options.projectKeys?.length ? inArray(project.key, options.projectKeys) : undefined)
    .orderBy(project.key);
  const plan: Rename[] = [];

  for (const target of projects) {
    const locale = options.locale ?? (await projectLocale(target.id));
    if (locale === 'en') continue;
    const names = defaultNames(locale);

    const states = await db
      .select({
        id: projectColumn.id,
        name: projectColumn.name,
        stateType: projectColumn.stateType,
      })
      .from(projectColumn)
      .where(eq(projectColumn.projectId, target.id))
      .orderBy(asc(projectColumn.position), asc(projectColumn.id));
    for (const state of DEFAULT_STATES) {
      for (const row of states) {
        if (row.name !== ENGLISH.states[state.key] || row.stateType !== state.stateType) continue;
        const next = rename(
          'state',
          row,
          names.states[state.key],
          target.key,
          states.map((s) => s.name),
        );
        if (next) plan.push(next);
      }
    }

    const types = await db
      .select({ id: issueType.id, name: issueType.name })
      .from(issueType)
      .where(eq(issueType.projectId, target.id))
      .orderBy(asc(issueType.position), asc(issueType.id));
    for (const row of types) {
      const key = (Object.keys(ENGLISH.issueTypes) as IssueTypeKey[]).find(
        (candidate) => ENGLISH.issueTypes[candidate] === row.name,
      );
      if (!key) continue;
      const next = rename(
        'issueType',
        row,
        names.issueTypes[key],
        target.key,
        types.map((t) => t.name),
      );
      if (next) plan.push(next);
    }

    const views = await db
      .select({ id: projectView.id, name: projectView.name, folderId: projectView.folderId })
      .from(projectView)
      .where(eq(projectView.projectId, target.id))
      .orderBy(asc(projectView.position), asc(projectView.id));
    for (const view of DEFAULT_VIEWS) {
      for (const row of views) {
        if (row.name !== ENGLISH.views[view.key] || row.folderId !== null) continue;
        const next = rename(
          'view',
          row,
          names.views[view.key],
          target.key,
          views.filter((v) => v.folderId === null).map((v) => v.name),
        );
        if (next) plan.push(next);
      }
    }

    const [coordinator] = await db
      .select({ id: user.id, name: user.name })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .where(
        and(
          eq(aiAgent.teamId, target.teamId),
          eq(aiAgent.username, projectCoordinatorUsername(target.key)),
        ),
      );
    if (coordinator && coordinator.name === coordinatorName(target.key, 'en')) {
      const next = rename(
        'coordinator',
        coordinator,
        coordinatorName(target.key, locale),
        target.key,
        [],
      );
      if (next) plan.push(next);
    }

    const labels = await db
      .select({ id: label.id, name: label.name })
      .from(label)
      .where(eq(label.projectId, target.id))
      .orderBy(asc(label.id));
    for (const row of labels) {
      if (row.name !== ENGLISH.blocked.label) continue;
      const next = rename(
        'label',
        row,
        names.blocked.label,
        target.key,
        labels.map((l) => l.name),
      );
      if (next) plan.push(next);
    }
  }

  const teamIds = [...new Set(projects.map((row) => row.teamId))];
  const teams = await db
    .select({ id: team.id, name: team.name })
    .from(team)
    .where(
      options.projectKeys?.length ? inArray(team.id, teamIds.length ? teamIds : [-1]) : undefined,
    )
    .orderBy(team.id);
  for (const target of teams) {
    const locale = options.locale ?? (await teamOwnerLocale(target.id));
    if (locale === 'en') continue;
    const roles = await db
      .select({ id: teamRole.id, name: teamRole.name, isDefault: teamRole.isDefault })
      .from(teamRole)
      .where(eq(teamRole.teamId, target.id))
      .orderBy(asc(teamRole.id));
    for (const row of roles) {
      if (!row.isDefault || row.name !== ENGLISH.teamRole) continue;
      const next = rename(
        'role',
        row,
        defaultNames(locale).teamRole,
        target.name,
        roles.map((r) => r.name),
      );
      if (next) plan.push(next);
    }
  }
  return plan;
}

// Writes the plan's renames that are not skipped, in one transaction.
async function applyPlan(plan: Rename[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of plan) {
      if (item.skipped) continue;
      const id = item.id;
      switch (item.kind) {
        case 'state':
          await tx
            .update(projectColumn)
            .set({ name: item.to })
            .where(eq(projectColumn.id, Number(id)));
          break;
        case 'issueType':
          await tx
            .update(issueType)
            .set({ name: item.to })
            .where(eq(issueType.id, Number(id)));
          break;
        case 'view':
          await tx
            .update(projectView)
            .set({ name: item.to })
            .where(eq(projectView.id, Number(id)));
          break;
        case 'coordinator':
          await tx
            .update(user)
            .set({ name: item.to })
            .where(eq(user.id, String(id)));
          break;
        case 'label':
          await tx
            .update(label)
            .set({ name: item.to })
            .where(eq(label.id, Number(id)));
          break;
        case 'role':
          await tx
            .update(teamRole)
            .set({ name: item.to })
            .where(eq(teamRole.id, Number(id)));
          break;
      }
    }
  });
}

export async function localizeDefaultNames(options: LocalizeOptions = {}): Promise<Rename[]> {
  const log = options.log ?? console.log;
  const plan = await planDefaultNameLocalization(options);
  for (const item of plan) {
    const verb = item.skipped
      ? `skip (${item.skipped})`
      : options.apply
        ? 'rename'
        : 'would rename';
    log(`${verb} ${item.scope} ${item.kind} "${item.from}" → "${item.to}"`);
  }
  const todo = plan.filter((item) => !item.skipped);
  if (options.apply && todo.length) await applyPlan(plan);
  log(
    options.apply
      ? `Renamed ${todo.length}, skipped ${plan.length - todo.length}.`
      : `Would rename ${todo.length}, skip ${plan.length - todo.length}. Run with --apply to write.`,
  );
  return plan;
}

function args(argv: string[]): LocalizeOptions {
  const options: LocalizeOptions = { apply: false, projectKeys: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--locale') {
      const value = argv[++i];
      if (!isLocale(value)) throw new Error(`Unknown --locale ${value ?? ''}`);
      options.locale = value;
    } else if (arg === '--project')
      options.projectKeys!.push(String(argv[++i] ?? '').toUpperCase());
    else throw new Error(`Unknown argument ${arg}`);
  }
  // --dry-run wins over --apply when both are given.
  if (argv.includes('--dry-run')) options.apply = false;
  return options;
}

if (import.meta.main) {
  await localizeDefaultNames(args(process.argv.slice(2)));
  process.exit(0);
}
