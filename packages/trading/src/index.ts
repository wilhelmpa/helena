// @helena/trading: the building blocks of Helena's trading project
// (docs/helena-decisions/trading.md). Helena's agents research, analyse, backtest, keep the
// journal and trade only in a paper account; live trading is out of scope and impossible
// by construction:
//
//   - the Alpaca paper connector knows only the paper hosts and refuses live keys;
//   - its order tools check the owner's hard limits before every order;
//   - every other way to place an order weighs as `pay` (@helena/policy trading.ts), and the
//     live trading hosts are on the project's egress deny list.
//
// The decision classes sort news, check a written rule and route a task; they never decide
// an entry or an exit.

export * from './alpaca/hosts';
export * from './alpaca/limits';
export * from './alpaca/checks';
export * from './alpaca/client';
export * from './alpaca/tools';
export * from './alpaca/execution';
export * from './alpaca/pending';
export * from './alpaca/connector';
export * from './decisions/questions';
export * from './decisions/classes';
export { NEWS_EVAL, NEWS_CASES } from './decisions/news';
export { RULE_EVAL, RULE_CASES } from './decisions/rules';
export { ROUTING_EVAL, ROUTING_CASES } from './decisions/routing';
export { LIVE_TRADING_HOSTS } from '@helena/policy';
