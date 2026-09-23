import { describe, it, expect } from 'bun:test';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { generateSshKey, sshKeyComment } from '../../ssh-key';

// Reads the length-prefixed fields of an OpenSSH key blob.
function fields(buffer: Buffer, offset = 0): { values: Buffer[]; end: number } {
  const values: Buffer[] = [];
  let at = offset;
  while (at + 4 <= buffer.length) {
    const length = buffer.readUInt32BE(at);
    if (at + 4 + length > buffer.length) break;
    values.push(buffer.subarray(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return { values, end: at };
}

describe('generateSshKey', () => {
  it('writes a public key line and a private key OpenSSH can read, of one key pair', () => {
    const key = generateSshKey('deploy@plan');
    const [type, blob, comment] = key.publicKey.split(' ');
    expect(type).toBe('ssh-ed25519');
    expect(comment).toBe('deploy@plan');
    const [blobType, pub] = fields(Buffer.from(blob, 'base64')).values;
    expect(blobType.toString()).toBe('ssh-ed25519');
    expect(pub).toHaveLength(32);

    const lines = key.privateKey.trim().split('\n');
    expect(lines[0]).toBe('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(lines.at(-1)).toBe('-----END OPENSSH PRIVATE KEY-----');
    const body = Buffer.from(lines.slice(1, -1).join(''), 'base64');
    const magic = 'openssh-key-v1\0';
    expect(body.subarray(0, magic.length).toString()).toBe(magic);
    // Cipher, KDF and KDF options, then the key count, the public key and the private
    // section.
    const header = fields(body, magic.length).values;
    expect(header.slice(0, 3).map(String)).toEqual(['none', 'none', '']);
    const countAt = magic.length + 4 + 4 + 4 + 4 + 4;
    expect(body.readUInt32BE(countAt)).toBe(1);
    const privateSection = fields(body, countAt + 4).values[1];
    expect(privateSection.length % 8).toBe(0);
    expect(privateSection.readUInt32BE(0)).toBe(privateSection.readUInt32BE(4));
    const [privType, privPub, privKey, privComment] = fields(privateSection, 8).values;
    expect(privType.toString()).toBe('ssh-ed25519');
    expect(privPub.equals(pub)).toBe(true);
    expect(privKey.subarray(32).equals(pub)).toBe(true);
    expect(privComment.toString()).toBe('deploy@plan');

    const x = pub.toString('base64url');
    const d = privKey.subarray(0, 32).toString('base64url');
    const privateKey = createPrivateKey({
      key: { kty: 'OKP', crv: 'Ed25519', d, x },
      format: 'jwk',
    });
    const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
    const signature = sign(null, Buffer.from('plan'), privateKey);
    expect(verify(null, Buffer.from('plan'), publicKey, signature)).toBe(true);
  });

  it('generates a new pair each time', () => {
    expect(generateSshKey('a').publicKey).not.toBe(generateSshKey('a').publicKey);
  });

  it('turns a label into a comment without spaces', () => {
    expect(sshKeyComment('GitHub deploy (prod)')).toBe('GitHub-deploy-prod');
    expect(sshKeyComment('   ')).toBe('plan');
  });
});
