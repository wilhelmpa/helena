import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { consoleLogger, toJsonSchema } from '@helena/sdk';
import type { ToolConfig } from '@repo/agent-tools';
import { registries } from '#shared/helena';
import { errorMessage } from '../../helpers/errors';

// Builds Mastra tools for the configured tools enabled on an agent. Each tool binds
// its catalog entry's execute to the decrypted credential it was configured with, so
// the model only supplies the call-time input. A tool whose key is no longer in the
// catalog is skipped. When the same tool is enabled more than once (bound to different
// credentials), the ids are suffixed so they do not collide.
export function buildCustomTools(
  items: { id: number; toolKey: string; credential: ToolConfig }[],
): Record<string, ReturnType<typeof createTool>> {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.toolKey, (counts.get(it.toolKey) ?? 0) + 1);

  const tools: Record<string, ReturnType<typeof createTool>> = {};
  for (const it of items) {
    // A connector's tool (@helena/sdk registry): built-in integrations and plugins alike.
    const tool = registries.tools.get(it.toolKey);
    if (!tool?.connector) continue;
    const id = (counts.get(it.toolKey) ?? 0) > 1 ? `${tool.name}_${it.id}` : tool.name;
    tools[id] = createTool({
      id,
      description: tool.description,
      inputSchema: isZod(tool.inputSchema) ? tool.inputSchema : jsonSchemaInput(tool),
      execute: async (input) => {
        try {
          return await tool.handler(input, {
            agent: null,
            project: null,
            credential: it.credential,
            log: consoleLogger(`tool ${tool.name}`),
          });
        } catch (err) {
          // Surface the failure to the model as a result rather than aborting the run.
          return { error: errorMessage(err, 'Tool call failed') };
        }
      },
    });
  }
  return tools;
}

// Mastra takes a zod schema or a JSON Schema wrapped by its own helper; the built-in
// integrations use zod, a plugin may hand over plain JSON Schema.
function isZod(schema: unknown): schema is z.ZodType {
  return (
    !!schema &&
    typeof schema === 'object' &&
    '~standard' in schema &&
    (schema as { '~standard': { vendor?: string } })['~standard'].vendor === 'zod'
  );
}

function jsonSchemaInput(tool: { inputSchema: unknown }): z.ZodType {
  return z.fromJSONSchema(toJsonSchema(tool.inputSchema as Record<string, unknown>));
}
