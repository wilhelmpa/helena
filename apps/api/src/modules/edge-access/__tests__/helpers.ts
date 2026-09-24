import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { setEdgeKeyResolverForTests } from '../providers';

export const TEAM = 'helena-test.cloudflareaccess.com';
export const AUD = 'a'.repeat(64);

// A stand-in for Cloudflare's signing keys: a local RS256 pair whose public half is served
// to the verifier instead of https://<team>/cdn-cgi/access/certs.
export async function testSigner() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  setEdgeKeyResolverForTests((team) => {
    if (team !== TEAM) throw new Error(`unexpected team ${team}`);
    return keys;
  });
  return async (
    claims: Record<string, unknown> = {},
    options: { issuer?: string; audience?: string; expiresIn?: string; key?: CryptoKey } = {},
  ) =>
    new SignJWT({ email: 'owner@example.com', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(options.issuer ?? `https://${TEAM}`)
      .setAudience(options.audience ?? AUD)
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '5m')
      .sign(options.key ?? privateKey);
}
