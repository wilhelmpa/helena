import { t } from 'elysia';

// The health overview's view of the model logins agents share (service.ts).

const loginState = t.Union(
  [
    t.Literal('ok'),
    t.Literal('expiring'),
    t.Literal('expired'),
    t.Literal('error'),
    t.Literal('invalid'),
    t.Literal('unknown'),
  ],
  {
    description:
      "'ok' usable and renewed before it runs out; 'expiring' due for renewal, which waits " +
      "for a moment without agent runs; 'expired' its access token ran out; 'error' renewing " +
      "failed for now and is retried; 'invalid' the provider rejected it, sign in again.",
  },
);

export const runtimeLogin = t.Object({
  store: t.String({ description: "Where it lives: 'hermes' (Hermes' root store), 'codex-cli'." }),
  provider: t.String(),
  id: t.String(),
  label: t.Nullable(t.String()),
  managed: t.Boolean({ description: 'Whether something renews it; else it is only reported.' }),
  state: loginState,
  expiresAt: t.Nullable(t.String()),
  refreshedAt: t.Nullable(t.String()),
  error: t.Nullable(t.String()),
  command: t.Nullable(
    t.String({ description: 'What the owner runs in the owner terminal to sign it in again.' }),
  ),
  note: t.Nullable(t.String()),
});

export const runtimeLoginsHealth = t.Object(
  {
    reports: t.Array(
      t.Object({
        source: t.String(),
        reporter: t.String(),
        checkedAt: t.String(),
        intervalSeconds: t.Nullable(t.Number()),
        stale: t.Boolean({
          description: 'The reporter has not written for three of its intervals.',
        }),
        logins: t.Array(runtimeLogin),
        errors: t.Array(t.String()),
      }),
    ),
    problems: t.Number({
      description: 'Logins the owner has to act on, in reports that are not stale.',
    }),
  },
  {
    description:
      'The model logins agents share, as the token keeper renews them ' +
      '(docs/helena-decisions/token-keeper.md). Names, states and times only.',
  },
);
