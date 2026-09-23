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
  'Every chain a transfer can start from right now, with how many venues accept it as an origin. Cache it; it changes when a venue adds or drops a chain.');
describe('/bridge/routes', 'get', 'Get routes',
  'Which venues serve a corridor, and with which assets. `tokenSymbols` is capped; `tokenSymbolCount` is exact. `privacy=true` narrows to venues a private transfer may use. The response carries `Cache-Control: max-age=30` and an `ETag`.');
describe('/bridge/venues', 'get', 'Get venues',
  'Every venue BRDG quotes: whether it is on, its health, and its capabilities: which trade types it prices, how its quote is executed, whether it needs `userIp`, and its privacy model.');
describe('/bridge/quote', 'post', 'Get quote',
  'Price a transfer across every venue that serves it. `best` is the row `build` executes by default; `bestByPrice` and `bestByTime` name rows in `quotes` by `quoteId`; `rejected` lists venues that could not price it, with a reason. Every `amountOutAtomic` is already net of the platform fee. Send `sender`, and `recipient` when the destination uses a different address format. Send `userIp` when calling on behalf of your users. `indicative: true` is comparison pricing and cannot be built.');
describe('/bridge/build', 'post', 'Build transaction',
  'Turn a quote into the unsigned transactions a wallet signs. Pass `quoteId` to build a row other than `best`. `steps` is every transaction to sign, in order; only `main` moves the order. A deposit-address venue returns `deposit` instead of `steps`. `expectedOutAtomic` equals the `amountOutAtomic` of the row you built. Idempotent per `decisionId`.');
describe('/bridge/transfers/{id}/submit', 'post', 'Submit transaction',
  'Hand back the signed transaction for BRDG to broadcast, or the hash of one your wallet already sent. Exactly one of `signedTransaction` and `txHash`. The transaction is decoded and compared to the steps that were built; anything else is refused and nothing is broadcast. Idempotent: a repeat answers with the hash on record and `accepted: false`.');
describe('/bridge/transfers/{id}', 'get', 'Get transfer',
  'Read one transfer by id. Open to anyone holding the id. Poll until `status` is `COMPLETED`, `PARTIAL`, `REFUNDED`, `FAILED` or `ABANDONED`.');

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
