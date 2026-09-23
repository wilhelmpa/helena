import { t } from 'elysia';

const command = t.String({
  pattern: '^[a-z0-9][a-z0-9-]{0,39}$',
  description: 'What follows the slash in the composer: lowercase letters, digits and dashes.',
});

export const chatPromptListQuery = t.Object({
  projectKey: t.Optional(
    t.String({ description: "Also the prompts of this project, next to the member's Home ones." }),
  ),
});

export const createChatPromptBody = t.Object({
  command,
  title: t.String({ minLength: 1, maxLength: 120 }),
  content: t.String({
    minLength: 1,
    maxLength: 16_000,
    description: 'The text inserted into the composer. {{name}} marks a variable.',
  }),
  projectKey: t.Optional(
    t.String({ description: "Offer the prompt in this project's chats only." }),
  ),
});

export const updateChatPromptBody = t.Partial(t.Omit(createChatPromptBody, ['projectKey']));

export const chatPromptParams = t.Object({ promptId: t.Numeric() });

export const ChatPromptResponse = t.Object({
  id: t.Number(),
  command: t.String(),
  title: t.String(),
  content: t.String(),
  project: t.Nullable(t.Object({ key: t.String(), name: t.String() })),
  createdAt: t.String(),
  updatedAt: t.String(),
});
