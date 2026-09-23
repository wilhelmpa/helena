import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import {
  ChatPromptResponse,
  chatPromptListQuery,
  chatPromptParams,
  createChatPromptBody,
  updateChatPromptBody,
} from './model';
import { createChatPrompt, deleteChatPrompt, listChatPrompts, updateChatPrompt } from './service';

// The caller's own prompt library for the chat composer. Every route reads and changes
// only the caller's prompts.
export const chatPromptRoutes = new Elysia({
  name: 'chat-prompts',
  detail: { tags: ['Chat Prompts'] },
})
  .use(authContext)
  .get(
    '/chat-prompts',
    ({ query, user }) => listChatPrompts(requireUser(user).id, query.projectKey),
    {
      query: chatPromptListQuery,
      response: { 200: t.Array(ChatPromptResponse), ...commonErrors },
      detail: {
        summary: 'List chat prompts',
        description: "The caller's Home prompts, and a project's when one is named.",
      },
    },
  )
  .post(
    '/chat-prompts',
    async ({ body, user, set }) => {
      set.status = 201;
      return createChatPrompt(requireUser(user).id, body);
    },
    {
      body: createChatPromptBody,
      response: { 201: ChatPromptResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Create a chat prompt' },
    },
  )
  .patch(
    '/chat-prompts/:promptId',
    async ({ params, body, user }) => {
      const updated = await updateChatPrompt(requireUser(user).id, params.promptId, body);
      if (!updated) throw new HttpError(404, 'Prompt not found');
      return updated;
    },
    {
      params: chatPromptParams,
      body: updateChatPromptBody,
      response: { 200: ChatPromptResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Update a chat prompt' },
    },
  )
  .delete(
    '/chat-prompts/:promptId',
    async ({ params, user }) => {
      if (!(await deleteChatPrompt(requireUser(user).id, params.promptId))) {
        throw new HttpError(404, 'Prompt not found');
      }
      return noContent();
    },
    {
      params: chatPromptParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Delete a chat prompt' },
    },
  );
