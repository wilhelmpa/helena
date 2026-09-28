import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { generateKeyPair } from 'jose';
import {
  cloudflareAccessProvider,
  EdgeAccessError,
  setEdgeKeyResolverForTests,
  type EdgeAccessConfig,
} from '../../providers';
import { edgeEntry } from '../../service';
import { AUD, TEAM, testSigner } from '../helpers';

const config: EdgeAccessConfig = {
  provider: 'cloudflare-access',
  teamDomain: TEAM,
  audiences: [AUD],
  allowedEmails: [],
};

const headers = (token?: string) => new Headers(token ? { 'cf-access-jwt-assertion': token } : {});

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EdgeAccessError) return error.code;
    throw error;
  }
  return 'accepted';
}

describe('Cloudflare Access provider', () => {
  let sign: Awaited<ReturnType<typeof testSigner>>;
  beforeAll(async () => {
    sign = await testSigner();
  });
  afterAll(() => setEdgeKeyResolverForTests(null));

  it('accepts an assertion signed by the team for the audience', async () => {
    const identity = await cloudflareAccessProvider.verify(headers(await sign()), config);
    expect(identity).toMatchObject({ provider: 'cloudflare-access', email: 'owner@example.com' });
  });

  it('refuses a request without an assertion', async () => {
    expect(await refusal(cloudflareAccessProvider.verify(headers(), config))).toBe(
      'missing_assertion',
    );
  });

  it('refuses another audience, another issuer, an expired token and a foreign key', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const cases = [
      await sign({}, { audience: 'b'.repeat(64) }),
      await sign({}, { issuer: 'https://other.cloudflareaccess.com' }),
      await sign({}, { expiresIn: '-10m' }),
      await sign({}, { key: privateKey }),
      'not-a-jwt',
    ];
    for (const token of cases) {
      expect(await refusal(cloudflareAccessProvider.verify(headers(token), config))).toBe(
        'invalid_assertion',
      );
    }
  });

  it('holds an identity outside the allowed list back at the origin', async () => {
    const strict = { ...config, allowedEmails: ['owner@example.com'] };
    expect(await refusal(cloudflareAccessProvider.verify(headers(await sign()), strict))).toBe(
      'accepted',
    );
    const stranger = await sign({ email: 'Someone@Example.com' });
    expect(await refusal(cloudflareAccessProvider.verify(headers(stranger), strict))).toBe(
      'identity_not_allowed',
    );
    const serviceToken = await sign({ email: undefined, common_name: 'client.access' });
    expect(await refusal(cloudflareAccessProvider.verify(headers(serviceToken), strict))).toBe(
      'identity_not_allowed',
    );
  });

  it('accepts only a Cloudflare team domain and 64-hex audience tags', () => {
    expect(cloudflareAccessProvider.validate(config)).toBeNull();
    for (const teamDomain of ['evil.example.com', 'x.cloudflareaccess.com.evil.net', '']) {
      expect(cloudflareAccessProvider.validate({ ...config, teamDomain })).not.toBeNull();
    }
    expect(cloudflareAccessProvider.validate({ ...config, audiences: [] })).not.toBeNull();
    expect(cloudflareAccessProvider.validate({ ...config, audiences: ['short'] })).not.toBeNull();
  });
});

describe('edgeEntry', () => {
  it('recognises the strict LAN marker and treats unknown markers as tunnel', () => {
    expect(edgeEntry(new Headers())).toBeNull();
    expect(edgeEntry(new Headers({ 'x-helena-entry': ' ' }))).toBeNull();
    expect(edgeEntry(new Headers({ 'x-helena-entry': 'tunnel' }))).toBe('tunnel');
    expect(edgeEntry(new Headers({ 'x-helena-entry': 'lan' }))).toBe('lan');
    expect(edgeEntry(new Headers({ 'x-helena-entry': 'unknown' }))).toBe('tunnel');
  });
});
