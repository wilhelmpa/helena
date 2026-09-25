import type { HelenaPlugin } from '@helena/sdk';
import { scheduleChatReflection } from './service';

// Learning from chats as an internal plugin (docs/helena-decisions/agent-context.md §5): a
// subscriber of the chat's domain event that queues the thread's reflection after each answer
// that succeeded. In process right after the event; the queue itself survives restarts.
export const CHAT_LEARNING_PLUGIN_ID = 'helena.chat-learning';
export const CHAT_LEARNING_EVENTS = ['helena.chat.message'];

export const chatLearningPlugin: HelenaPlugin = {
  register(ctx) {
    ctx.events.subscribe(
      CHAT_LEARNING_EVENTS,
      async (event) => {
        const data = event.data as {
          threadId?: unknown;
          messageId?: unknown;
          role?: unknown;
          status?: unknown;
          agentId?: unknown;
        };
        if (data.role !== 'assistant' || data.status !== 'success') return;
        if (
          typeof data.threadId !== 'string' ||
          typeof data.messageId !== 'number' ||
          typeof data.agentId !== 'number'
        ) {
          return;
        }
        await scheduleChatReflection({
          threadId: data.threadId,
          agentId: data.agentId,
          messageId: data.messageId,
        });
      },
      { id: 'schedule', durable: false },
    );
  },
};
