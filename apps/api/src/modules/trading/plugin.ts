import type { HelenaPlugin, PluginManifest } from '@helena/sdk';
import { alpacaPaperConnector, PAPER_HOSTS, TRADING_DECISION_CLASSES } from '@helena/trading';
import { paperExecution } from './execution';

// Trading as an internal plugin (docs/helena-decisions/trading.md): the Alpaca paper account
// as a connector whose tools reach an agent only as configured tools (agents/tools/run.ts),
// and the trading decision classes, which stay off until their evals pass.

export const TRADING_PLUGIN_ID = 'helena.trading';

const connector = alpacaPaperConnector({ execution: paperExecution });

export const TRADING_PROVIDES: PluginManifest['provides'] = {
  connectors: [connector.id],
  tools: (connector.tools ?? []).map((tool) => tool.name),
  decisionClasses: TRADING_DECISION_CLASSES.map((entry) => entry.id),
};

export const TRADING_PERMISSIONS: PluginManifest['permissions'] = {
  // A paper order is `write`: it moves no money.
  actions: ['read', 'write'],
  credentials: true,
  network: [...PAPER_HOSTS],
};

// The manifest the API loads it with (modules/plugins/builtin.ts) and scripts that need its
// connector in the registry (the blueprint script).
export function tradingManifest(): PluginManifest {
  return {
    id: TRADING_PLUGIN_ID,
    name: { i18n: 'god.plugins.names.trading' },
    version: '1.0.0',
    sdk: '^0.1.0',
    provides: TRADING_PROVIDES,
    permissions: TRADING_PERMISSIONS,
  };
}

export const tradingPlugin: HelenaPlugin = {
  register(ctx) {
    ctx.connectors.register(connector);
    for (const decisionClass of TRADING_DECISION_CLASSES)
      ctx.decisionClasses.register(decisionClass);
  },
};
