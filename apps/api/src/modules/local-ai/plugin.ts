import type { HelenaPlugin } from '@helena/sdk';
import { BUILTIN_MODEL_SERVERS } from './server-types';
import { BUILTIN_TASK_CLASSES } from './task-classes';

// Local AI as the internal plugin `helena.local-ai` (docs/helena-decisions/local-ai-platform.md):
// the model server types Helena knows (Lemonade, any OpenAI-compatible server) and the kinds of
// work local AI may take, registered like a plugin's would be.
export const LOCAL_AI_PLUGIN_ID = 'helena.local-ai';

export const localAiPlugin: HelenaPlugin = {
  register(ctx) {
    for (const type of BUILTIN_MODEL_SERVERS) ctx.modelServers.register(type);
    for (const entry of BUILTIN_TASK_CLASSES) ctx.localAiTaskClasses.register(entry);
  },
};

export const LOCAL_AI_PROVIDES = {
  modelServers: BUILTIN_MODEL_SERVERS.map((type) => type.id),
  localAiTaskClasses: BUILTIN_TASK_CLASSES.map((entry) => entry.id),
};
