import type { MailAddress } from './parse';

export interface MailRuleMatch {
  accountId: number | null;
  matchType: 'address' | 'domain';
  value: string;
  projectId: number;
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase();
}

// The addresses a rule is matched against: the sender, or for a message the account
// sent itself, its recipients.
export function ruleAddresses(
  ownAddress: string,
  from: MailAddress | null,
  recipients: MailAddress[],
): string[] {
  const own = ownAddress.toLowerCase();
  if (from && from.address && from.address !== own) return [from.address];
  return recipients.map((item) => item.address).filter((item) => item && item !== own);
}

// The rule that routes a message: an address rule wins over a domain rule, a rule of
// the account over one for every account, and the first address over later ones.
export function matchMailRule<Rule extends MailRuleMatch>(
  rules: Rule[],
  accountId: number,
  addresses: string[],
): Rule | null {
  let best: Rule | null = null;
  let bestRank = Infinity;
  for (const [position, address] of addresses.entries()) {
    for (const rule of rules) {
      if (rule.accountId != null && rule.accountId !== accountId) continue;
      const value = rule.value.toLowerCase();
      const hit = rule.matchType === 'address' ? value === address : value === domainOf(address);
      const rank =
        (rule.accountId == null ? 2 : 0) + (rule.matchType === 'domain' ? 1 : 0) + position * 4;
      if (hit && rank < bestRank) {
        best = rule;
        bestRank = rank;
      }
    }
  }
  return best;
}
