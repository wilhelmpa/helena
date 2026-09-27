import type { UpdateCandidate, UpdateProgress, UpdateSource } from '@helena/sdk';
import { HttpError } from '#shared/lib';
import { decideProposal } from '#modules/agents/proposals/service';
import {
  checkHermesUpdate,
  hermesUpdateState,
  requestHermesUpdate,
  storedHermesUpdate,
  type StoredState,
  type VersionRef,
} from '#modules/runtime-admin/hermes-update';

// Hermes, the runtime Helena's agents run on. The check is the existing one: a Hermes
// runner hands it to its root helper (helena-hermes-update), which fetches the upstream in
// the checkout and lists the commits an update brings and the local commits it carries over.
// Applying raises the Hermes update proposal and decides it as the owner who clicked, so the
// helper does the update with its own rollback, exactly as from the approvals page.

export const HERMES_SOURCE_ID = 'hermes';
const REPOSITORY = 'https://github.com/NousResearch/hermes-agent';

// How old the last check may be before the scheduled check asks the runner again.
const RECHECK_MS = 6 * 3_600_000;

function label(ref: VersionRef): string {
  const name = ref.version ?? ref.describe ?? ref.commit.slice(0, 8);
  return ref.version ? `${name} (${ref.commit.slice(0, 8)})` : name;
}

export function toCandidate(state: StoredState | null, error: string | null): UpdateCandidate {
  if (!state) {
    return {
      component: 'hermes',
      name: 'Hermes',
      installed: null,
      available: null,
      updateAvailable: false,
      security: false,
      sourceUrl: REPOSITORY,
      notesUrl: `${REPOSITORY}/commits/main`,
      applicable: false,
      error,
    };
  }
  const { current, latest, commits, localPatches } = state.check;
  const behind =
    current.commit !== latest.commit && state.check.latestIsAncestor !== true && commits.length > 0;
  return {
    component: 'hermes',
    name: 'Hermes',
    installed: label(current),
    available: label(latest),
    updateAvailable: behind,
    security: false,
    sourceUrl: REPOSITORY,
    notesUrl: `${REPOSITORY}/compare/${current.commit.slice(0, 12)}...${latest.commit.slice(0, 12)}`,
    applicable: behind,
    detail: `${commits.length} commits · ${localPatches.length} local${state.offline ? ' · cached Git refs' : ''}`,
    error,
    data: { target: latest.commit, checkedAt: state.checkedAt },
  };
}

export const hermesSource: UpdateSource = {
  id: HERMES_SOURCE_ID,
  label: { i18n: 'updates.sources.hermes' },
  kind: 'runtime',
  order: 10,
  hosts: [],
  async check(context) {
    const stored = await storedHermesUpdate();
    const fresh =
      stored && !stored.offline && Date.now() - Date.parse(stored.checkedAt) < RECHECK_MS;
    if (fresh && !context.manual) return [toCandidate(stored, null)];
    try {
      return [toCandidate(await checkHermesUpdate(null), null)];
    } catch (failure) {
      // No Hermes runner online: the last check still says what is installed, and the list
      // says why it is not newer.
      if (failure instanceof HttpError && failure.status === 503) {
        return [{ ...toCandidate(stored, null), hint: { i18n: 'updates.hints.hermesOffline' } }];
      }
      const message = failure instanceof Error ? failure.message : String(failure);
      return [toCandidate(stored, message)];
    }
  },
  async releaseNotes(candidate) {
    const stored = await storedHermesUpdate();
    if (!stored || !candidate.updateAvailable) return null;
    const lines = stored.check.commits
      .slice(0, 150)
      .map((commit) => `- ${commit.date} ${commit.subject}`);
    const local = stored.check.localPatches.map((commit) => `- ${commit.subject}`);
    return [
      `Upstream commits (${stored.check.commits.length}, newest first):`,
      ...lines,
      ...(local.length ? ['', 'Local commits carried over:', ...local] : []),
    ].join('\n');
  },
  async apply(_request, context) {
    // An update someone requested on the approvals page is the same update: it is decided
    // here instead of being requested twice.
    const pending = (await hermesUpdateState(context.userId)).proposal;
    const proposalId = pending?.status === 'pending' ? pending.id : await requestHermesUpdate();
    // The owner's click in the update center is the approval: the proposal is decided as
    // theirs, which hands the update to the helper.
    await decideProposal({ id: context.userId, isOwner: true }, proposalId, true, 'Update center');
    return { ref: String(proposalId) };
  },
  async progress(ref, context): Promise<UpdateProgress> {
    const state = await hermesUpdateState(context.userId);
    const proposal = state.proposal;
    if (!proposal || String(proposal.id) !== ref) return { state: 'running' };
    if (proposal.status === 'applied') return { state: 'done', log: proposal.log };
    if (proposal.status === 'failed' || proposal.status === 'rejected') {
      return { state: 'failed', log: proposal.log, error: proposal.error ?? 'The update failed' };
    }
    return { state: 'running', log: proposal.log };
  },
};
