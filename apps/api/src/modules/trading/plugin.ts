import type { HelenaPlugin, PluginManifest } from '@helena/sdk';
import { alpacaPaperConnector, PAPER_HOSTS, TRADING_DECISION_CLASSES } from '@helena/trading';

// Trading as an internal plugin (docs/helena-decisions/trading.md): the Alpaca paper account
// as a connector whose tools reach an agent only as configured tools (agents/tools/run.ts),
// and the trading decision classes, which stay off until their evals pass.

export const TRADING_PLUGIN_ID = 'helena.trading';

const connector = alpacaPaperConnector();

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

export const tradingPlugin: HelenaPlugin = {
  register(ctx) {
    ctx.connectors.register(connector);
    for (const decisionClass of TRADING_DECISION_CLASSES) ctx.decisionClasses.register(decisionClass);
  },
};
