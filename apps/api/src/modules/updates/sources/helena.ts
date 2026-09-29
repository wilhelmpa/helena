import type { UpdateSource } from '@helena/sdk';
import { htmlToText } from '../feeds';
import { getUpdateStatus } from '#modules/settings/updates';
import { getDisplayName } from '@repo/db';

// Helena itself, for an installation that follows a published release feed
// (UPDATE_FEED_URL, settings/updates.ts). Without one there is nothing to compare with and
// the source lists nothing: an instance deployed from its own repository is updated by its
// deploy, not here.

export const HELENA_SOURCE_ID = 'helena';

export const helenaSource: UpdateSource = {
  id: HELENA_SOURCE_ID,
  label: { i18n: 'updates.sources.helena' },
  kind: 'app',
  order: 50,
  // The feed is read by settings/updates.ts, from the host the operator configured.
  hosts: [],
  async check(context) {
    if (!process.env.UPDATE_FEED_URL?.trim()) return [];
    const status = await getUpdateStatus(context.manual);
    return [
      {
        component: 'helena',
        name: await getDisplayName(),
        installed: status.currentVersion,
        available: status.latestVersion,
        updateAvailable: status.updateAvailable,
        security: false,
        notesUrl: status.releases.find((release) => release.url)?.url ?? null,
        applicable: false,
        hint: { i18n: 'updates.hints.deploy' },
        error: status.checkedAt ? null : 'The release feed could not be read',
      },
    ];
  },
  async releaseNotes(candidate) {
    const status = await getUpdateStatus();
    const newer = status.releases.filter(
      (release) => release.version !== candidate.installed && release.url,
    );
    if (newer.length === 0) return null;
    return newer
      .map(
        (release) =>
          `## ${release.version}\n${release.notesFormat === 'html' ? htmlToText(release.notes) : release.notes}`,
      )
      .join('\n\n');
  },
};
