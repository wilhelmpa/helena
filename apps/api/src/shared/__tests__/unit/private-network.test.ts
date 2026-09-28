import { describe, expect, it } from 'bun:test';
import { privateNetworkPreflightAllowed } from '../../private-network';

const OWN = ['https://helena.example.com', 'https://helena-home.example.com'];

function request(method: string, headers: Record<string, string>) {
  return new Request('http://localhost/edge/home/probe', { method, headers });
}

describe('privateNetworkPreflightAllowed (Private Network Access)', () => {
  it('allows the preflight of one of Helena’s own origins', () => {
    const headers = {
      origin: 'https://helena.example.com',
      'access-control-request-private-network': 'true',
    };
    expect(privateNetworkPreflightAllowed(request('OPTIONS', headers), OWN)).toBe(true);
    expect(
      privateNetworkPreflightAllowed(
        request('options', { ...headers, 'access-control-request-private-network': ' TRUE ' }),
        OWN,
      ),
    ).toBe(true);
  });

  it('gives a foreign or missing origin nothing', () => {
    for (const origin of ['https://evil.example.com', 'null', '']) {
      const headers: Record<string, string> = { 'access-control-request-private-network': 'true' };
      if (origin) headers.origin = origin;
      expect(privateNetworkPreflightAllowed(request('OPTIONS', headers), OWN)).toBe(false);
    }
  });

  it('answers only a preflight that asks for it', () => {
    const origin = 'https://helena.example.com';
    expect(privateNetworkPreflightAllowed(request('OPTIONS', { origin }), OWN)).toBe(false);
    expect(
      privateNetworkPreflightAllowed(
        request('OPTIONS', { origin, 'access-control-request-private-network': 'false' }),
        OWN,
      ),
    ).toBe(false);
    expect(
      privateNetworkPreflightAllowed(
        request('GET', { origin, 'access-control-request-private-network': 'true' }),
        OWN,
      ),
    ).toBe(false);
  });
});
