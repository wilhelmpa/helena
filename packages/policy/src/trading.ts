// Money that moves at a broker or an exchange is a person's decision (docs/helena-decisions/
// trading.md §5). Helena's agents trade only in a paper account, through Helena's own paper
// tools; everything below makes any other way of placing an order weigh as `pay`, which the
// Autopilot never lets through without a person's approval, at every level:
//
//   - an MCP tool of any server but Helena's own whose name says it places, changes or
//     cancels an order, closes a position or withdraws funds;
//   - a shell command or a piece of code that names the trading API of a broker or an
//     exchange (the live hosts below).
//
// The same host list is the TRADE project's egress deny list, so the network refuses these
// hosts to the agents as well. Paper and test hosts are not on it: Alpaca's paper API
// (paper-api.alpaca.markets) and market data (data.alpaca.markets), Binance's Spot Testnet
// (testnet.binance.vision), Kraken's futures demo (demo-futures.kraken.com), Bybit's testnet
// (api-testnet.bybit.com), Tradier's sandbox, OANDA's practice API. Venues whose paper and
// live trading share one host (OKX, Saxo, Interactive Brokers' Web API) are listed whole:
// a hostname cannot tell them apart.

export const LIVE_TRADING_HOSTS: readonly string[] = [
  // Alpaca: the live trading API and the Broker API. Paper is paper-api.alpaca.markets.
  'api.alpaca.markets',
  'broker-api.alpaca.markets',
  // Binance (spot, futures, portfolio margin, options, WebSocket API) and Binance.US.
  'api.binance.com',
  'api1.binance.com',
  'api2.binance.com',
  'api3.binance.com',
  'api4.binance.com',
  'api-gcp.binance.com',
  'fapi.binance.com',
  'dapi.binance.com',
  'papi.binance.com',
  'eapi.binance.com',
  'ws-api.binance.com',
  'api.binance.us',
  // Kraken spot and futures.
  'api.kraken.com',
  'futures.kraken.com',
  // Bybit (its public stream host also serves live WebSocket trading).
  'api.bybit.com',
  'api.bytick.com',
  'api.bybit.eu',
  'stream.bybit.com',
  // Coinbase.
  'api.coinbase.com',
  'api.exchange.coinbase.com',
  'api.prime.coinbase.com',
  'api.international.coinbase.com',
  // OKX: demo and live trading share the REST host (a header switches them).
  'okx.com',
  // Other exchanges.
  'api.bitvavo.com',
  'api.bitpanda.com',
  'api.exchange.bitpanda.com',
  'api.kucoin.com',
  'api-futures.kucoin.com',
  'api.gateio.ws',
  'api.bitget.com',
  'api.mexc.com',
  'contract.mexc.com',
  'api.bitfinex.com',
  'api.gemini.com',
  'api.crypto.com',
  'api.huobi.pro',
  'api.htx.com',
  'api.hyperliquid.xyz',
  // Brokers with a public trading API.
  'api.ibkr.com',
  'api.tradier.com',
  'api-fxtrade.oanda.com',
  'stream-fxtrade.oanda.com',
  'gateway.saxobank.com',
  'api.tastyworks.com',
  'api.tastytrade.com',
  'live.trading212.com',
  'api.schwabapi.com',
  'api.etrade.com',
  'api.robinhood.com',
];

// The MCP servers that are Helena itself. Their tools carry their own category (Helena's
// paper tools are `write`: a paper account moves no money).
export const HELENA_MCP_SERVERS: readonly string[] = ['itsaplan', 'helena', 'plan'];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A host counts with its subdomains, as in the egress lists (www.okx.com is okx.com), but
// never as the tail of a longer label (paper-api.alpaca.markets is not api.alpaca.markets)
// and not followed by more name.
const HOST_PATTERN = new RegExp(
  `(^|[^a-z0-9.-])(?:[a-z0-9-]+\\.)*(${LIVE_TRADING_HOSTS.map(escape).join('|')})($|[^a-z0-9.-]|\\.(?![a-z0-9]))`,
  'i',
);

// Whether a command line or a piece of code names a live trading API.
export function mentionsLiveTradingHost(text: string | null | undefined): boolean {
  return !!text && HOST_PATTERN.test(text);
}

// Tool names split the way servers write them: snake_case, kebab-case, dotted or camelCase.
function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[-.\s]+/g, '_');
}

const ORDER_TOOL: RegExp[] = [
  // place_order, submit_order, place_stock_order, cancel_all_orders, replace_order_by_id,
  // close_position, close_all_positions, exercise_options_position, create_order … but not
  // create_trade_journal or cancel_order_report, which only record or report.
  /(^|_)(place|submit|create|new|send|replace|modify|amend|edit|cancel|close|liquidate|exercise)_(all_)?((stock|crypto|options?|market|limit|stop|spot|futures?|margin|perp|conditional|bracket|oco|oto)_)*(order|orders|trade|trades|position|positions)(?!_(journal|journals|note|notes|log|logs|report|reports|history|summary|analysis|idea|ideas|plan|plans|alert|alerts|review|reviews|stats|statistics|list))(_|$)/,
  // order_create, orders_cancel …
  /(^|_)orders?_(create|submit|place|cancel|replace|amend|new|send)(_|$)/,
  // buy, sell, swap as the verb of the tool.
  /^(buy|sell|swap|market_buy|market_sell|limit_buy|limit_sell)(_|$)/,
  /^trade(_(stock|stocks|crypto|option|options|asset|assets|token|tokens|coin|coins|spot|futures?))?$/,
  // withdraw, withdrawal, transfer_funds, send_crypto …
  /(^|_)withdraw(al|als)?(_|$)/,
  /(^|_)(transfer|send|move)_(funds|crypto|coins?|assets?|money|tokens?|balance)(_|$)/,
];

// Whether an MCP tool name says it places, changes or cancels an order, closes a position
// or moves funds.
export function isOrderToolName(name: string): boolean {
  const normalized = words(name);
  return ORDER_TOOL.some((pattern) => pattern.test(normalized));
}

export function isHelenaMcpServer(server: string): boolean {
  return HELENA_MCP_SERVERS.includes(server.toLowerCase());
}
