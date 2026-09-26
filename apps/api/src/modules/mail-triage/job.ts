import { registerSystemJob } from '#modules/engine/system-jobs';
import { anyTeamClassifies, classifyPending } from './classify';

// Check every connected mailbox four times a day in the owner's local time. The engine
// persists the last fire, so a restart cannot silently advance past a due check.
export const MAIL_TRIAGE_JOB_ID = 'helena.mail-triage';
export const MAIL_TRIAGE_CRON = '0 8,12,16,20 * * *';
export const MAIL_TRIAGE_TIMEZONE = 'Europe/Berlin';

registerSystemJob({
  id: MAIL_TRIAGE_JOB_ID,
  async schedule() {
    return {
      enabled: await anyTeamClassifies(),
      cron: MAIL_TRIAGE_CRON,
      timezone: MAIL_TRIAGE_TIMEZONE,
    };
  },
  async run(context) {
    await context.step('classify', () => classifyPending());
  },
});
