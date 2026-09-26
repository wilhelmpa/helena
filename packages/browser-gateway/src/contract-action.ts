import type { ActionCategory } from './agent-tool.ts';

// Classify only controls that themselves name an outside contractual consequence.
// A navigation control such as "Manage subscription" stays an ordinary click.
export function disablesAutomaticRenewal(label: string | null | undefined): boolean {
  if (!label) return false;
  return (
    /(?:disable|deactivat|turn\s+off|stop|cancel|deaktivier|deaktivierung|ausschalt|abschalt|kündig)/i.test(
      label,
    ) &&
    /(?:automatic\s+renewal|auto[\s-]?renewal|automatische[nrsm]?\s+verlängerung|autoverlängerung)/i.test(
      label,
    )
  );
}

export function contractActionCategory(label: string | null | undefined): ActionCategory | null {
  if (!label) return null;
  if (disablesAutomaticRenewal(label)) return 'delete';
  const subject =
    /(?:subscription|contract|membership|domain|account|renewal|abonnement|abo\b|vertrag|mitgliedschaft|konto|verlängerung)/i;
  if (!subject.test(label)) return null;
  if (
    /(?:cancel|cancell?ation|terminate|termination|delete|remove|close|kündig|stornier|lösch|entfern|schließ)/i.test(
      label,
    )
  )
    return 'delete';
  if (
    /(?:enable|activate|reactivate|renew|subscribe|upgrade|downgrade|change\s+plan|switch\s+plan|aktivier|reaktivier|verlänger|abschließ|buchen)/i.test(
      label,
    )
  )
    return 'pay';
  return null;
}
