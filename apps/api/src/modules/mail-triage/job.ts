import { registerSystemJob } from '#modules/engine/system-jobs';
import { anyTeamClassifies, classifyPending } from './classify';

// The mail classifier's engine job (docs/helena-decisions/decisions.md §5): every minute while
// a team has the class on, the new inbox mail is classified, at most 20 per team and tick.
export const MAIL_TRIAGE_JOB_ID = 'helena.mail-triage';

registerSystemJob({
  id: MAIL_TRIAGE_JOB_ID,
  async schedule() {
    return { enabled: await anyTeamClassifies(), cron: '* * * * *', timezone: 'UTC' };
  },
  async run(context) {
    await context.step('classify', () => classifyPending());
  },
});
