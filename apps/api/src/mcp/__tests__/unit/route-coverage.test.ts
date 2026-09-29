import { describe, expect, it } from 'bun:test';
import { app } from '../../../app';
import { routeTools } from '../../generate';
import exceptions from '../../route-exceptions.json';

const routeKey = (method: string, path: string) => `${method} ${path}`;
const exceptionClasses = new Set(['intern', 'binär', 'auth', 'admin', 'UI-only']);

describe('MCP route coverage', () => {
  it('classifies every API route exactly once as a tool or an explicit exception', () => {
    const routes = new Set(app.routes.map((route) => routeKey(route.method, route.path)));
    const tools = routeTools(app);
    const toolRoutes = new Set(tools.map((tool) => routeKey(tool.method, tool.path)));
    const excluded = new Set<string>();

    expect(tools.map((tool) => tool.name).length).toBe(
      new Set(tools.map((tool) => tool.name)).size,
    );
    for (const [method, path, reason] of exceptions) {
      const key = routeKey(method, path);
      expect(exceptionClasses.has(reason)).toBe(true);
      expect(routes.has(key)).toBe(true);
      expect(toolRoutes.has(key)).toBe(false);
      expect(excluded.has(key)).toBe(false);
      excluded.add(key);
    }
    expect([...routes].filter((key) => !toolRoutes.has(key) && !excluded.has(key))).toEqual([]);
    expect([...toolRoutes].filter((key) => !routes.has(key))).toEqual([]);
  });

  it('keeps the newly added tools on guarded JSON routes with explicit action hints', () => {
    const newTools = routeTools(app).filter((tool) =>
      /^(bulk_|get_board_issues|list_archived_issues|list_issue_checklists|list_issue_feed_by_status|get_issue_status_timeline|get_issue_timeline_items|start_issue_agent_team|list_issue_agent_team_runs|list_issue_cycle_history|search_knowledge_vault|list_recent_knowledge|list_knowledge_tree|create_knowledge_folder|move_knowledge_path|trash_knowledge_path|list_knowledge_trash|restore_knowledge_path|list_knowledge_conflicts|list_note_versions|read_note_version|resolve_knowledge_path|resolve_knowledge_wikilink|list_project_goal_chains|get_issue_claim|list_ai_agent_heartbeats|list_ai_agent_runs|archive_ai_agent_run|unarchive_ai_agent_run|preview_routine_mentions)/.test(
        tool.name,
      ),
    );
    expect(newTools).toHaveLength(33);
    for (const tool of newTools) {
      expect(tool.permission).toBeDefined();
      const route = app.routes.find(
        (candidate) => candidate.method === tool.method && candidate.path === tool.path,
      );
      const response = route?.hooks.response as Record<string, unknown> | undefined;
      expect(response?.['200'] ?? response?.['201']).toBeDefined();
    }
    expect(newTools.find((tool) => tool.name === 'bulk_delete_issues')?.category).toBe('delete');
    expect(newTools.find((tool) => tool.name === 'trash_knowledge_path')?.category).toBe('delete');
    expect(newTools.find((tool) => tool.name === 'start_issue_agent_team')?.category).toBe(
      'execute',
    );
  });

  it('refuses anonymous calls to the new project, vault and team routes', async () => {
    for (const path of [
      '/projects/VOL/issues/archived',
      '/knowledge/tree?root=Projects/VOL',
      '/teams/1/ai-agents/1/runs',
    ]) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(401);
    }
  });
});
