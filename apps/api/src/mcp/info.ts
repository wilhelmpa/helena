import pkg from '../../../../package.json';

// How the MCP endpoint introduces itself in the initialize response (the MCP
// Implementation object): the product name and the release in the root package.json,
// which release-please bumps, the same version the OpenAPI document states.
export const SERVER_INFO = { name: 'helena', title: 'Ava', version: pkg.version };
