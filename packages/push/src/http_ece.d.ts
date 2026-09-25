// http_ece (the reference RFC 8188 implementation web-push is built on) has no types; the
// tests use it only to cross-check the fake device's decryption.
declare module 'http_ece' {
  const ece: {
    encrypt(buffer: Buffer, params: Record<string, unknown>): Buffer;
    decrypt(buffer: Buffer, params: Record<string, unknown>): Buffer;
  };
  export default ece;
}
