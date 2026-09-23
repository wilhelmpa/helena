import { generateKeyPairSync, randomBytes } from 'node:crypto';

// An ed25519 key pair in the formats OpenSSH reads: the public key as one
// authorized_keys line, the private key as an unencrypted OPENSSH PRIVATE KEY block.
// Node exports neither, so both are built from the raw key bytes (PROTOCOL.key in the
// OpenSSH sources describes the private key format).

const KEY_TYPE = 'ssh-ed25519';

function sshString(value: Buffer | string): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function uint32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
}

export function generateSshKey(comment: string): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync('ed25519');
  const jwk = pair.privateKey.export({ format: 'jwk' });
  const seed = Buffer.from(jwk.d!, 'base64url');
  const pub = Buffer.from(jwk.x!, 'base64url');
  const publicBlob = Buffer.concat([sshString(KEY_TYPE), sshString(pub)]);

  const check = randomBytes(4);
  let privateSection = Buffer.concat([
    check,
    check,
    sshString(KEY_TYPE),
    sshString(pub),
    sshString(Buffer.concat([seed, pub])),
    sshString(comment),
  ]);
  const padding: number[] = [];
  for (let i = 1; (privateSection.length + padding.length) % 8 !== 0; i++) padding.push(i);
  privateSection = Buffer.concat([privateSection, Buffer.from(padding)]);

  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    sshString('none'),
    sshString('none'),
    sshString(''),
    uint32(1),
    sshString(publicBlob),
    sshString(privateSection),
  ]);
  const lines = body.toString('base64').match(/.{1,70}/g)!;
  return {
    publicKey: `${KEY_TYPE} ${publicBlob.toString('base64')} ${comment}`,
    privateKey: [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      ...lines,
      '-----END OPENSSH PRIVATE KEY-----',
      '',
    ].join('\n'),
  };
}

// The comment of a generated key: the credential's label, reduced to what an
// authorized_keys line carries without quoting.
export function sshKeyComment(label: string): string {
  return label.replace(/[^A-Za-z0-9._@-]+/g, '-').replace(/^-+|-+$/g, '') || 'plan';
}
