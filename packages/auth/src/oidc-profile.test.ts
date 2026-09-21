import { describe, expect, it } from 'bun:test';
import { oidcProfileLabel } from './oidc-profile';

describe('OIDC optional profile claims', () => {
  it('accepts an Access profile with only email and sub without forging verification', () => {
    expect(oidcProfileLabel({ sub: 'stable-id', email: 'owner@example.com' })).toEqual({
      name: 'owner@example.com',
    });
  });
  it('preserves a non-empty provider display name', () => {
    expect(oidcProfileLabel({ name: ' Owner ', email: 'owner@example.com' })).toEqual({
      name: 'Owner',
    });
  });
  it('does not invent identity when usable profile claims are missing', () => {
    expect(oidcProfileLabel({ name: '', email: {}, sub: 'id' })).toEqual({});
  });
});
