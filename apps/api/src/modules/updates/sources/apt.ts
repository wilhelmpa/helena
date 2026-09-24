import type { UpdateCandidate, UpdateSource } from '@helena/sdk';
import { debianChangelogSince, NOTES_MAX_CHARS } from '../feeds';
import { sendHelperRequest } from '../helper';
import { helperProgress } from './cli-runtimes';
import { hostInventory, type HostInventory } from './vendors';

// The operating system's packages (Debian): what apt would upgrade, from the lists
// apt-daily.timer refreshes, as the root helper's inventory reads them (`apt-get -s
// dist-upgrade`, grouped by source package). A candidate from a `-security` suite is a
// security update. Applying runs `apt-get install --only-upgrade` of the chosen packages in
// the helper, after the API took a database dump; every package of the group shares one
// summary.

export const APT_SOURCE_ID = 'apt';
export const APT_GROUP = 'apt';
const CHANGELOG_HOST = 'metadata.ftp-master.debian.org';

type AptPackage = NonNullable<NonNullable<HostInventory['apt']>['packages']>[number];

const NAME = /^[a-z0-9][a-z0-9+.-]{0,127}$/;

// Debian packages Helena's services run on (the project browsers' Chromium): shown with their
// version even when there is nothing to upgrade. Source package and name.
const WATCHED: [string, string][] = [['chromium', 'Chromium']];

// Debian's changelog path: `lib` packages are filed under their first four letters.
function changelogUrl(source: string, component: string): string {
  const prefix = source.startsWith('lib') ? source.slice(0, 4) : source.slice(0, 1);
  return `https://${CHANGELOG_HOST}/changelogs/${component}/${prefix}/${source}/stable_changelog`;
}

function toCandidate(entry: AptPackage): UpdateCandidate | null {
  const source = entry.source?.trim();
  if (!source || !NAME.test(source)) return null;
  const packages = (entry.packages ?? []).filter((name) => NAME.test(name));
  if (packages.length === 0) return null;
  const component = ['main', 'contrib', 'non-free', 'non-free-firmware'].includes(
    entry.component ?? '',
  )
    ? entry.component!
    : 'main';
  return {
    component: source,
    name: source,
    installed: entry.installed?.trim() || null,
    available: entry.candidate?.trim() || null,
    updateAvailable: Boolean(entry.candidate),
    security: entry.security === true,
    sourceUrl: entry.security
      ? `https://security-tracker.debian.org/tracker/source-package/${source}`
      : `https://tracker.debian.org/pkg/${source}`,
    notesUrl: changelogUrl(source, component),
    group: APT_GROUP,
    applicable: true,
    detail: packages.join(', '),
    data: { packages, origin: entry.origin ?? null, archive: component },
  };
}

export const aptSource: UpdateSource = {
  id: APT_SOURCE_ID,
  label: { i18n: 'updates.sources.apt' },
  kind: 'system',
  order: 30,
  hosts: [CHANGELOG_HOST],
  async check(context) {
    const inventory = await hostInventory(context);
    // Without the helper nothing is known about the packages: the source fails and keeps
    // what the last check found, rather than reporting "nothing to upgrade".
    if (!inventory?.apt) throw new Error('The update helper reported no package list');
    const candidates = (inventory.apt.packages ?? [])
      .map((entry) => toCandidate(entry))
      .filter((entry): entry is UpdateCandidate => entry !== null);
    // The packages Helena's own services run on are listed even when they are current.
    for (const [component, name] of WATCHED) {
      const installed = inventory.tools?.[component];
      if (candidates.some((entry) => entry.component === component) || !installed) continue;
      candidates.push({
        component,
        name,
        installed,
        available: installed,
        updateAvailable: false,
        security: false,
        sourceUrl: `https://tracker.debian.org/pkg/${component}`,
        applicable: false,
      });
    }
    if (candidates.some((entry) => entry.updateAvailable)) return candidates;
    // Nothing to upgrade: one line that says so, with when the lists were read.
    return [
      ...candidates,
      {
        component: 'debian',
        name: inventory.apt.os?.trim() || 'Debian',
        installed: null,
        available: null,
        updateAvailable: false,
        security: false,
        applicable: false,
        detail: inventory.apt.listsUpdatedAt ?? null,
      },
    ];
  },
  async releaseNotes(candidate, context) {
    if (!candidate.notesUrl) return null;
    try {
      const text = await context.fetchText(candidate.notesUrl, { maxBytes: 1024 * 1024 });
      const since = debianChangelogSince(text, candidate.installed);
      return since ? since.slice(0, Math.floor(NOTES_MAX_CHARS / 2)) : null;
    } catch {
      // A package whose changelog is not published (yet) is summarized from its name and
      // versions alone.
      return null;
    }
  },
  async apply(request) {
    const chosen = request.components?.length ? request.components : [request.candidate];
    const packages = [
      ...new Set(
        chosen.flatMap((candidate) =>
          Array.isArray(candidate.data?.packages) ? (candidate.data.packages as string[]) : [],
        ),
      ),
    ].filter((name) => NAME.test(name));
    if (packages.length === 0) throw new Error('No package to upgrade');
    const ref = await sendHelperRequest('apt', { packages });
    return { ref };
  },
  progress: (ref) => helperProgress(ref),
};
