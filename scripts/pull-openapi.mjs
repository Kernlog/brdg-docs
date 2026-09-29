// Pull the API's own OpenAPI document and shape it for the public reference.
import { readFileSync, writeFileSync } from 'node:fs';

const API = process.env.BRIDGE_API ?? 'http://localhost:3001';
const PUBLIC_SERVER = 'https://api.brdg.now/v1';
const EXAMPLES = new URL('../openapi/examples/', import.meta.url);

const spec = await (await fetch(`${API}/v1/openapi.json`)).json();

// The public surface: markets, and quote -> build -> submit -> transfer. Everything
// else the API serves is for the BRDG app itself and is not documented here.
const PUBLIC_PATHS = [
  '/bridge/source-chains',
  '/bridge/routes',
  '/bridge/venues',
  '/bridge/quote',
  '/bridge/build',
  '/bridge/transfers/{id}/submit',
  '/bridge/transfers/{id}',
];
for (const path of Object.keys(spec.paths)) if (!PUBLIC_PATHS.includes(path)) delete spec.paths[path];

// Build fields that are always null on the public flow (the app's own HyperCore
// signing lanes). A HyperCore deposit needs nothing beyond `steps`.
const build = spec.paths['/bridge/build'].post.responses['200'].content['application/json'].schema;
for (const key of ['permit', 'relayFeePermit', 'spotTransfer']) delete build.properties[key];

spec.info = {
  ...spec.info,
  title: 'BRDG API',
  description: 'Quote, build, submit and track cross-chain transfers across every venue BRDG aggregates.',
};
spec.servers = [{ url: PUBLIC_SERVER }];

const example = (name) => JSON.parse(readFileSync(new URL(name, EXAMPLES), 'utf8'));
const set = (path, method, where, value) => {
  const op = spec.paths[path]?.[method];
  if (!op) throw new Error(`${method.toUpperCase()} ${path} is not in the spec`);
  const media =
    where === 'request'
      ? op.requestBody.content['application/json']
      : op.responses['200'].content['application/json'];
  media.example = value;
};

set('/bridge/quote', 'post', 'request', {
  fromChain: 'base',
  toChain: 'solana',
  fromToken: 'USDC',
  toToken: 'USDC',
  amountAtomic: '100000000',
  sender: '0x58E602386DB134b1F9B1d6d390C11A2B7b486677',
  recipient: '3BQtHR41iDPiu9skeSVzmBDpZKcKqEEDnMn6UkbAHvZz',
});
set('/bridge/quote', 'post', 'response', example('quote.json'));
set('/bridge/build', 'post', 'request', { decisionId: example('quote.json').decisionId });
set('/bridge/build', 'post', 'response', example('build.json'));
set('/bridge/transfers/{id}', 'get', 'response', example('transfer.json'));
set('/bridge/source-chains', 'get', 'response', example('source-chains.json'));
set('/bridge/routes', 'get', 'response', example('routes.json'));
set('/bridge/venues', 'get', 'response', example('venues.json'));

// Operation summaries and descriptions, written for an integrator.
const describe = (path, method, summary, description) => {
  const op = spec.paths[path][method];
  op.summary = summary;
  op.description = description;
};
describe('/bridge/source-chains', 'get', 'Get source chains',
  'Returns every chain a transfer can start from right now, with the number of venues that accept it as a source. The list changes only when a venue adds or drops a chain, so you can cache it.');
describe('/bridge/routes', 'get', 'Get routes',
  'Returns the venues that serve a route and the tokens each supports on it. `tokenSymbols` is a sample and `tokenSymbolCount` is the full count. Pass `privacy=true` to list only venues that can carry a private transfer. Responses are cacheable for 30 seconds and carry an `ETag`.');
describe('/bridge/venues', 'get', 'Get venues',
  'Returns every venue BRDG integrates: whether it is enabled, its health, and its capabilities, including the trade types it supports, what it gives a wallet to sign, whether it needs `userIp`, and its privacy model.');
describe('/bridge/quote', 'post', 'Get quote',
  'Prices a transfer at every venue that serves it and ranks the results by net output. `best` is the quote that `POST /bridge/build` uses by default. `bestByPrice` and `bestByTime` hold the `quoteId` of the cheapest and fastest quotes in `quotes`. Venues that could not quote are listed in `rejected` with a reason. Every `amountOutAtomic` already has the platform fee taken off.\n\nSend `sender`, and send `recipient` when the destination chain uses a different address format. If you call the API from a server on behalf of your users, send each user\'s IP address as `userIp`. A quote requested with `indicative: true` is for display only and cannot be built.');
describe('/bridge/build', 'post', 'Build transaction',
  'Turns a quote into the unsigned transactions the user signs. BRDG builds `best` unless you pass a `quoteId`. `steps` lists every transaction to sign, in order; the one with `step: "main"` is the bridge transaction. On a source chain no wallet can sign for, `steps` is empty and `deposit` says where to send the funds instead. `expectedOutAtomic` matches the `amountOutAtomic` of the quote you built. Building the same `decisionId` again returns the same transfer.');
describe('/bridge/transfers/{id}/submit', 'post', 'Submit transaction',
  'Accepts either a signed transaction for BRDG to broadcast (`signedTransaction`) or the hash of a transaction the wallet already sent (`txHash`). Send exactly one. BRDG decodes the transaction and compares it with the steps it built, and refuses anything that does not match without broadcasting it. Submitting the same transaction again returns the hash on record with `accepted: false`.');
describe('/bridge/transfers/{id}', 'get', 'Get transfer',
  'Returns one transfer. Anyone with the transfer id can read it. Poll until `status` is `COMPLETED`, `PARTIAL`, `REFUNDED`, `FAILED` or `ABANDONED`.');

// Field descriptions for the request bodies and the fields an integrator reads first. The API's
// own schema carries none.
const FIELDS = {
  '/bridge/quote post request': {
    fromChain: 'Chain key the transfer starts from, for example `base`.',
    toChain: 'Chain key the transfer ends on. Use `hypercore` for a Hyperliquid balance.',
    fromToken: 'Token to send: a symbol such as `USDC`, a token address, or `null` for the chain\'s native token.',
    toToken: 'Token to receive, in the same forms as `fromToken`. For Hyperliquid, `USDC (perps)` or `USDC (spot)`.',
    amountAtomic: 'Amount in the token\'s smallest unit, as a string. With `MIN_OUT` or `EXACT_OUT` it is an amount of `toToken`.',
    tradeType: '`EXACT_IN` (the default) fixes the amount sent. `EXACT_OUT` fixes the amount received. `MIN_OUT` sets the least that must be received.',
    slippageBps: 'Maximum slippage you accept, in basis points, from 0 to 5000. Defaults to 100 (1%).',
    sender: 'Wallet the funds leave from.',
    recipient: 'Wallet that receives the funds. Required when the destination uses a different address format from the source. Defaults to `sender`.',
    refundAddress: 'Where a venue sends a refund. Defaults to `sender`.',
    indicative: 'Set to `true` for a display-only price. An indicative quote cannot be built.',
    referralWallet: 'Wallet that receives your referral share. Must be valid on the source chain. Send together with `referralBps`.',
    referralBps: 'Your referral rate in basis points, from 0 to 15.',
    privacy: 'Set to `true` to use only venues that do not publish the link between sender and recipient.',
    userIp: 'The end user\'s IP address, when you call the API from a server on their behalf.',
  },
  '/bridge/build post request': {
    decisionId: 'The `decisionId` from the quote response.',
    quoteId: 'Build this quote instead of `best`. Must be a `quoteId` from the same quote response.',
    venue: 'Build this venue\'s quote instead of `best`.',
    privacy: 'Optional. Privacy already carries over from the quote.',
    userIp: 'Optional. `userIp` already carries over from the quote.',
  },
  '/bridge/transfers/{id}/submit post request': {
    signedTransaction: 'The signed transaction, for BRDG to broadcast. Send this or `txHash`.',
    txHash: 'The hash or signature of a transaction the wallet already sent. Send this or `signedTransaction`.',
    step: 'Which built step this transaction is. Usually `main`.',
    userIp: 'The end user\'s IP address, if the quote carried one.',
  },
  '/bridge/build post 200': {
    transferId: 'Id of the transfer. Use it to submit and to track.',
    steps: 'Transactions to sign, in order.',
    deposit: 'Set only when `steps` is empty: send exactly `amountAtomic` to `address` before `deadlineMs`.',
    expectedOutAtomic: 'Amount expected to arrive. Matches the quoted `amountOutAtomic`.',
    minOutAtomic: 'The least the transfer can deliver.',
    feeCapture: 'How the platform fee is collected. See the Fees page.',
    feeBatch: 'The steps a wallet with EIP-5792 batching can sign as one bundle.',
    expiresAt: 'Unix time in milliseconds after which these steps can no longer be submitted.',
  },
  '/bridge/transfers/{id} get 200': {
    status: 'Current status. See the Track a transfer guide.',
    statusDetail: 'Explanation of the current status, when there is one.',
    sourceTxHash: 'The source chain transaction.',
    destinationTxHash: 'The transaction that delivered the funds, when the venue reports one.',
    receivedAmountAtomic: 'Amount that actually arrived.',
    receivedAsset: 'Token that actually arrived.',
    fees: 'Each fee on this transfer, with its status.',
    postStep: 'Set on Hyperliquid deposits through Arbitrum. Reports the Hyperliquid credit.',
  },
};
for (const [where, fields] of Object.entries(FIELDS)) {
  const [path, method, part] = where.split(' ');
  const op = spec.paths[path][method];
  const schema = (part === 'request' ? op.requestBody : op.responses[part]).content['application/json'].schema;
  for (const [name, text] of Object.entries(fields)) {
    if (!schema.properties?.[name]) throw new Error(`${where}: no field ${name}`);
    schema.properties[name].description = text;
  }
}

// Response and field descriptions come from the API's own route definitions. A spaced hyphen used
// as a dash reads as one in the rendered reference, so it becomes a comma.
const walk = (node) => {
  if (Array.isArray(node)) return node.forEach(walk);
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'description' && typeof value === 'string') node[key] = value.replace(/ - /g, ', ');
      else walk(value);
    }
  }
};
walk(spec);

writeFileSync(new URL('../openapi/openapi.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n');
console.log(`wrote openapi/openapi.json: ${Object.keys(spec.paths).length} paths`);
