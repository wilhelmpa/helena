import { dispatchTool } from '../../dispatch';
import type { McpRouteTool } from '../../generate';
import { app } from '#tests/helpers/app';
import { sample } from '../../../../../../scripts/tool-regression/sample';
import type { seedToolStack } from './stack';

// These handlers control the operator's real checkout or model processes. Their
// positive fixtures need an injected operator adapter; they never run on this stack.
export const operatorTools = new Set(['apply_model_schema_changes', 'run_as_root']);

export class ToolFixtureResolver {
  readonly fields: Record<string, unknown>;
  private readonly created = new Map<string, unknown>();

  constructor(
    private readonly stack: Awaited<ReturnType<typeof seedToolStack>>,
    private readonly tools: McpRouteTool[],
  ) {
    this.fields = {
      ...stack.fields,
      startDate: '2026-10-01',
      endDate: '2026-10-08',
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-10-02T00:00:00.000Z',
      cron: '0 9 * * 1',
      instruction: 'ABSCHLUSSTEST',
      instructions: 'ABSCHLUSSTEST',
      command: 'printf ABSCHLUSSTEST',
      q: 'ABSCHLUSSTEST',
      query: 'ABSCHLUSSTEST',
      month: '2026-10',
      idempotencyKey: crypto.randomUUID(),
      filename: 'ABSCHLUSSTEST.txt',
      contentBase64: Buffer.from('ABSCHLUSSTEST').toString('base64'),
      ids: [stack.issue.id],
      orderedIds: [stack.issue.id],
      permissions: [],
      projectIds: [stack.project.id],
      agentToolIds: [],
      mcpServerIds: [],
      skillIds: [],
      capabilityRefs: [],
    };
  }

  async argumentsFor(tool: McpRouteTool, depth = 0): Promise<Record<string, unknown>> {
    const fields = { ...this.fields };
    for (const param of tool.pathParams) {
      if (param in fields || depth > 3) continue;
      const prefix = tool.path.split(`/:${param}`)[0]!;
      if (this.created.has(prefix)) {
        fields[param] = this.created.get(prefix);
        continue;
      }
      const create = this.tools.find(
        (candidate) => candidate.method === 'POST' && candidate.path === prefix,
      );
      if (!create || operatorTools.has(create.name) || create.access === 'person-only') continue;
      const args = await this.argumentsFor(create, depth + 1);
      const result = await dispatchTool(
        app,
        create,
        args,
        { kind: 'session', cookie: this.stack.owner.cookie },
        { viaMcpEndpoint: true },
      );
      if (
        result.structuredContent.ok &&
        result.structuredContent.data &&
        typeof result.structuredContent.data === 'object'
      ) {
        const data = result.structuredContent.data as Record<string, unknown>;
        const id = data.id ?? (data.agent as Record<string, unknown> | undefined)?.id;
        if (id !== undefined) {
          fields[param] = id;
          this.created.set(prefix, id);
        }
      }
    }
    const args = sample(tool.inputSchema, fields) as Record<string, unknown>;
    if (tool.name === 'write_note')
      Object.assign(args, {
        content: '# ABSCHLUSSTEST',
        path: `Projects/${this.stack.project.key}/Docs/ABSCHLUSSTEST-new.md`,
      });
    if (['preview_project_blueprint', 'apply_project_blueprint'].includes(tool.name))
      args.sections = ['project'];
    return args;
  }
}
