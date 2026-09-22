import { describe, expect, test } from 'bun:test';
import { classifyVaultHttpStatus, parseVaultAccessUrl } from '../service';

describe('Vault access status', () => {
  test('accepts only a clean HTTPS access origin', () => {
    expect(parseVaultAccessUrl('https://vault.example.com/')?.toString()).toBe(
      'https://vault.example.com/',
    );
    expect(parseVaultAccessUrl('http://vault.example.com/')).toBeNull();
    expect(parseVaultAccessUrl('https://user:pass@vault.example.com/')).toBeNull();
    expect(parseVaultAccessUrl('https://vault.example.com/?token=secret')).toBeNull();
    expect(parseVaultAccessUrl('https://vault.example.com/admin')).toBeNull();
  });

  test('describes access protection without claiming backend health', () => {
    expect(classifyVaultHttpStatus(302)).toBe('protected');
    expect(classifyVaultHttpStatus(401)).toBe('protected');
    expect(classifyVaultHttpStatus(403)).toBe('protected');
    expect(classifyVaultHttpStatus(200)).toBe('reachable');
    expect(classifyVaultHttpStatus(503)).toBe('unavailable');
  });
});
