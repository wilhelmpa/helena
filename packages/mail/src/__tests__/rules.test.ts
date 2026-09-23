import { describe, expect, it } from 'bun:test';
import { matchMailRule, ruleAddresses, type MailRuleMatch } from '../rules';

const rule = (overrides: Partial<MailRuleMatch>): MailRuleMatch => ({
  accountId: null,
  matchType: 'domain',
  value: 'verve.example',
  projectId: 1,
  ...overrides,
});

describe('matchMailRule', () => {
  it('matches a domain and an exact address, the address first', () => {
    const rules = [
      rule({ projectId: 1 }),
      rule({ matchType: 'address', value: 'ceo@verve.example', projectId: 2 }),
    ];
    expect(matchMailRule(rules, 7, ['ceo@verve.example'])?.projectId).toBe(2);
    expect(matchMailRule(rules, 7, ['team@verve.example'])?.projectId).toBe(1);
    expect(matchMailRule(rules, 7, ['someone@other.example'])).toBeNull();
  });

  it('prefers a rule of the account and ignores rules of other accounts', () => {
    const rules = [
      rule({ accountId: 8, projectId: 3 }),
      rule({ projectId: 1 }),
      rule({ accountId: 7, projectId: 2 }),
    ];
    expect(matchMailRule(rules, 7, ['a@verve.example'])?.projectId).toBe(2);
    expect(matchMailRule(rules, 9, ['a@verve.example'])?.projectId).toBe(1);
  });

  it('compares case-insensitively', () => {
    expect(
      matchMailRule([rule({ value: 'Verve.Example' })], 1, ['x@verve.example']),
    ).not.toBeNull();
  });
});

describe('ruleAddresses', () => {
  const me = { name: 'Me', address: 'me@home.example' };
  const other = { name: 'Other', address: 'other@verve.example' };
  it('uses the sender, or the recipients of a message the account sent', () => {
    expect(ruleAddresses('me@home.example', other, [me])).toEqual(['other@verve.example']);
    expect(ruleAddresses('Me@Home.example', me, [other, me])).toEqual(['other@verve.example']);
  });
});
