import { describe, expect, it } from 'bun:test';
import { ipv6Prefix64, isLanAddress } from '../../lan';

const own = ['2003:c3:173d:760e'];

describe('isLanAddress', () => {
  it('takes the private IPv4 ranges and never loopback', () => {
    expect(isLanAddress('192.168.2.182', own)).toBe(true);
    expect(isLanAddress('::ffff:10.0.0.4', own)).toBe(true);
    expect(isLanAddress('172.20.1.1', own)).toBe(true);
    expect(isLanAddress('127.0.0.1', own)).toBe(false);
    expect(isLanAddress('8.8.8.8', own)).toBe(false);
  });

  it('takes link-local, unique-local and this machine’s own /64, never ::1 or another /64', () => {
    expect(isLanAddress('fe80::1', own)).toBe(true);
    expect(isLanAddress('fd12:3456::1', own)).toBe(true);
    expect(isLanAddress('2003:c3:173d:760e:20f0:2436:5d9b:2b41', own)).toBe(true);
    expect(isLanAddress('2003:c3:173d:760f::1', own)).toBe(false);
    expect(isLanAddress('2a00:1450:4001::200e', own)).toBe(false);
    expect(isLanAddress('::1', own)).toBe(false);
  });
});

describe('ipv6Prefix64', () => {
  it('normalises the first four groups', () => {
    expect(ipv6Prefix64('2003:00c3:173d:760e::1')).toBe('2003:c3:173d:760e');
    expect(ipv6Prefix64('2003:c3::1')).toBe('2003:c3:0:0');
    expect(ipv6Prefix64('fe80::1%wlan0')).toBe('fe80:0:0:0');
    expect(ipv6Prefix64('192.168.1.1')).toBeNull();
    expect(ipv6Prefix64('1::2::3')).toBeNull();
  });
});
