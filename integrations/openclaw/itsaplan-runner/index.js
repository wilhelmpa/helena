import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { loadPreparedModelCatalog } from 'openclaw/plugin-sdk/agent-runtime';
import { buildAgentMainSessionKey } from 'openclaw/plugin-sdk/routing';
import { ItsaplanRunner } from './runner-core.js';
import { writeManagedMarkdown } from './managed-markdown.js';

export default definePluginEntry({
  id: 'itsaplan-runner',
  name: 'Its-a-Plan Runner',
  description: 'Routes external Its-a-Plan agent runs to fixed OpenClaw agents.',
  register(api) {
    let runner;
    api.agent.events.registerAgentEventSubscription({
      id: 'itsaplan-chat-stream',
      description: "Forwards this runner's assistant and tool events to native Plan chat.",
      streams: ['assistant', 'tool'],
      handle(event) {
        return runner?.handleAgentEvent(event);
      },
    });
    api.registerService({
      id: 'itsaplan-runner',
      async start() {
        runner = new ItsaplanRunner({
          config: api.pluginConfig,
          run: (request) => api.runtime.subagent.run(request),
          waitForRun: (request) => api.runtime.subagent.waitForRun(request),
          getSessionMessages: (request) => api.runtime.subagent.getSessionMessages(request),
          loadModelCatalog: (agentId) =>
            loadPreparedModelCatalog({
              agentId,
              config: api.runtime.config.current(),
              refreshFullCatalog: true,
              allowGatewaySubagentBinding: true,
            }),
          resolveThinkingPolicy: (request) => api.runtime.agent.resolveThinkingPolicy(request),
          normalizeThinkingLevel: (value) => api.runtime.agent.normalizeThinkingLevel(value),
          resolveDefaultModel: (agentId) =>
            api.runtime.modelConfig.resolveDefaultModelForAgent({
              cfg: api.runtime.config.current(),
              agentId,
            }),
          resolveModelSelection: ({ agentId, raw, catalog }) => {
            const cfg = api.runtime.config.current();
            const defaultModel = api.runtime.modelConfig.resolveDefaultModelForAgent({
              cfg,
              agentId,
            });
            return api.runtime.modelConfig.resolveAllowedModelRef({
              cfg,
              catalog,
              raw,
              defaultProvider: defaultModel.provider,
              defaultModel,
              agentId,
            });
          },
          cancelRun: async ({ agentId, runId }) => {
            const cfg = api.runtime.config.current();
            const ownerSessionKey = buildAgentMainSessionKey({
              agentId,
              mainKey: cfg.session?.mainKey,
            });
            const binding = {
              sessionKey: ownerSessionKey,
              agentId,
            };
            const task = await api.runtime.tasks.async.runs.bindSession(binding).resolve(runId);
            if (!task || task.runId !== runId) {
              return {
                found: false,
                cancelled: false,
                reason: 'Exact OpenClaw task not found.',
              };
            }
            return api.runtime.tasks.runs.bindSession(binding).cancel({ taskId: task.id, cfg });
          },
          adapterId: 'openclaw',
          adapterCapabilities: [
            'instructions',
            'memory',
            'managed-markdown',
            'skills',
            'tools',
            'mcp',
            'model',
            'reasoning',
            'projects',
          ],
          applyRuntimePolicies: (policies) => applyOpenClawPolicies(api, policies),
          logger: api.logger,
        });
        runner.start();
        api.logger.info?.('itsaplan-runner: started with tool-capable runs and persistent chat');
      },
      async stop() {
        await runner?.stop();
        runner = undefined;
      },
    });
  },
});

async function applyOpenClawPolicies(api, policies) {
  const cfg = api.runtime.config.current();
  const entries = cfg.agents?.entries;
  if (!entries || typeof entries !== 'object') throw new Error('OpenClaw agent config is missing');
  for (const { agent, snapshot } of policies) {
    const agentId = agent.openclawAgentId;
    if (!entries[agentId]) throw new Error(`Mapped runtime agent does not exist: ${agentId}`);
    const workspace = api.runtime.agent.resolveAgentWorkspaceDir(cfg, agentId);
    for (const file of snapshot.runtimePolicy?.files ?? []) {
      await writeManagedMarkdown(workspace, file);
    }
  }

  if (
    !policies.some(({ agent, snapshot }) => policyChanged(entries[agent.openclawAgentId], snapshot))
  ) {
    return;
  }
  await api.runtime.config.mutateConfigFile({
    afterWrite: { mode: 'auto' },
    mutate: (draft) => {
      const draftEntries = draft.agents?.entries;
      if (!draftEntries || typeof draftEntries !== 'object') {
        throw new Error('OpenClaw agent config is missing');
      }
      for (const { agent, snapshot } of policies) {
        const entry = draftEntries[agent.openclawAgentId];
        if (!entry) {
          throw new Error(`Mapped runtime agent does not exist: ${agent.openclawAgentId}`);
        }
        applyPolicy(entry, snapshot);
      }
    },
  });
}

function policyValues(snapshot) {
  const desired = snapshot.runtimePolicy ?? {};
  return {
    skills: snapshot.skills.map((skill) => skill.name),
    alsoAllow: [...new Set([...(desired.toolAllow ?? []), ...(desired.mcpGrants ?? [])])],
    deny: [...new Set(desired.toolDeny ?? [])],
    memoryEnabled: snapshot.memory.enabled,
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function policyChanged(entry, snapshot) {
  const desired = snapshot.runtimePolicy ?? {};
  const values = policyValues(snapshot);
  return (
    (snapshot.model && entry.model?.primary !== snapshot.model) ||
    (desired.reasoningEffort && entry.thinkingDefault !== desired.reasoningEffort) ||
    !same(entry.skills ?? [], values.skills) ||
    !same(entry.tools?.alsoAllow ?? [], values.alsoAllow) ||
    !same(entry.tools?.deny ?? [], values.deny) ||
    entry.memory?.search?.enabled !== values.memoryEnabled ||
    entry.memory?.search?.rememberAcrossConversations !== values.memoryEnabled
  );
}

function applyPolicy(entry, snapshot) {
  const desired = snapshot.runtimePolicy ?? {};
  const values = policyValues(snapshot);
  if (snapshot.model) entry.model = { ...(entry.model ?? {}), primary: snapshot.model };
  if (desired.reasoningEffort) entry.thinkingDefault = desired.reasoningEffort;
  entry.skills = values.skills;
  entry.tools = { ...(entry.tools ?? {}), alsoAllow: values.alsoAllow, deny: values.deny };
  entry.memory = {
    ...(entry.memory ?? {}),
    search: {
      ...(entry.memory?.search ?? {}),
      enabled: values.memoryEnabled,
      rememberAcrossConversations: values.memoryEnabled,
    },
  };
}
