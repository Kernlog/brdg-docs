// Pull the API's own OpenAPI document and shape it for the public reference.
import { readFileSync, writeFileSync } from 'node:fs';

const API = process.env.BRIDGE_API ?? 'http://localhost:3001';
const PUBLIC_SERVER = 'https://api.bridg.now/v1';
const EXAMPLES = new URL('../openapi/examples/', import.meta.url);

const spec = await (await fetch(`${API}/v1/openapi.json`)).json();

// The ops lane is authenticated by OPS_TOKEN and is not a public surface.
for (const path of Object.keys(spec.paths)) if (path.startsWith('/ops')) delete spec.paths[path];

spec.info = {
  ...spec.info,
  title: 'Bridg API',
  description: 'Quote, build, submit and track cross-chain transfers across every venue Bridg aggregates.',
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
set('/bridge/orders/{id}', 'get', 'response', example('transfer.json'));
set('/bridge/source-chains', 'get', 'response', example('source-chains.json'));
set('/bridge/routes', 'get', 'response', example('routes.json'));
set('/bridge/venues', 'get', 'response', example('venues.json'));

writeFileSync(new URL('../openapi/openapi.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n');
console.log(`wrote openapi/openapi.json: ${Object.keys(spec.paths).length} paths`);
