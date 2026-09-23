import { t } from 'elysia';

export const revQuery = t.Object({
  scopes: t.String({
    description:
      "Comma-separated scopes to read, each '<kind>:<id>' — board, documents, actionRuns, controlPlane, agentRuns or inbox by project id, issue, initiative, or hubInbox by team id.",
  }),
});

export const RevResponse = t.Object({ revs: t.Record(t.String(), t.String()) });
