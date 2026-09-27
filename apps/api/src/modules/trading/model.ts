import { t } from 'elysia';
import { oneOf } from '#shared/schemas';

export const tradingProjectParams = t.Object({ projectKey: t.String() });

export const strategyApprovalBody = t.Object(
  {
    credentialId: t.Integer({ minimum: 1 }),
    strategyId: t.String({ pattern: '^[a-z0-9][a-z0-9-]{1,39}$' }),
    strategyVersion: t.String({ pattern: '^\\d{1,3}(\\.\\d{1,3}){0,2}$' }),
    issueId: t.Optional(t.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const publicNewsBody = t.Object(
  {
    kind: t.Literal('news'),
    publicNews: t.Object(
      {
        articleText: t.String({ minLength: 1, maxLength: 8000 }),
        instruments: t.Array(t.String({ minLength: 1, maxLength: 120 }), {
          minItems: 1,
          maxItems: 30,
        }),
        publicDataConfirmed: t.Literal(true, {
          description:
            'The caller explicitly permits sharing this public article text and these instrument names with the configured cloud service. This is a declaration, not server verification of publicity. Never include accounts, positions, balances or private rules.',
        }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const legacyClassifyBody = t.Object(
  {
    kind: oneOf(['news', 'rule', 'routing'], {
      description:
        "'news': relevance for the watchlist, direction and kind of event of one news item; " +
        "'rule': whether a planned paper trade meets one written rule; 'routing': which role " +
        'of the trading team takes a task.',
    }),
    context: t.String({
      minLength: 1,
      maxLength: 8000,
      description:
        "Legacy/private input; all decision attempts stay local. news: news and any private context. rule: the planned trade. routing: the task's title and description. For explicitly shared public news, omit context and use publicNews instead.",
    }),
    rule: t.Optional(
      t.String({
        maxLength: 1500,
        description: 'For kind rule: the rule of Regelwerk.md, word for word.',
      }),
    ),
  },
  { additionalProperties: false },
);

// Public branch first: the MCP schema merger retains the legacy kind enum from
// the final branch. The real route enforces exclusive branches, including extras.
export const classifyBody = t.Union([publicNewsBody, legacyClassifyBody]);

const Answer = t.Object({
  choice: t.Nullable(t.String()),
  label: t.Nullable(t.String()),
  confidence: t.Nullable(t.Number()),
  decided: t.Boolean(),
});

export const ClassifyResponse = t.Object({
  status: t.String({
    description:
      'decided (every answer above the threshold), unsure (answered, not all above it), ' +
      'off (the class is switched off), no_backend, timeout or error: then decide yourself.',
  }),
  answers: t.Record(t.String(), Answer),
  threshold: t.Number(),
  model: t.Nullable(t.String()),
  latencyMs: t.Nullable(t.Number()),
});
