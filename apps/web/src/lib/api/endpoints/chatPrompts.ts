import { request } from '@/lib/api/core/client';

// A saved prompt of the member's library, inserted with /<command>. `{{name}}` in the
// content is a variable. A prompt with a project is offered in that project only.
export interface ChatPrompt {
  id: number;
  command: string;
  title: string;
  content: string;
  project: { key: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatPromptInput {
  command: string;
  title: string;
  content: string;
  projectKey?: string;
}

export const listChatPrompts = (projectKey?: string | null) =>
  request<ChatPrompt[]>(
    '/chat-prompts' + (projectKey ? `?projectKey=${encodeURIComponent(projectKey)}` : ''),
  );

export const createChatPrompt = (input: ChatPromptInput) =>
  request<ChatPrompt>('/chat-prompts', { method: 'POST', body: JSON.stringify(input) });

export const updateChatPrompt = (id: number, patch: Partial<Omit<ChatPromptInput, 'projectKey'>>) =>
  request<ChatPrompt>(`/chat-prompts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteChatPrompt = (id: number) =>
  request<void>(`/chat-prompts/${id}`, { method: 'DELETE' });
