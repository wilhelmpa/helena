import { expect, test } from 'bun:test';
import { contractActionCategory, disablesAutomaticRenewal } from './contract-action';

test('renewal cancellation is an external contract action', () => {
  expect(disablesAutomaticRenewal('Disable automatic renewal of bumbleandthebees.com')).toBe(true);
  expect(disablesAutomaticRenewal('Deaktivierung der automatischen Verlängerung bestätigen')).toBe(
    true,
  );
  expect(disablesAutomaticRenewal('Open domain settings')).toBe(false);
  expect(disablesAutomaticRenewal('Enable automatic renewal')).toBe(false);
});

test('explicit contract and subscription controls receive hard-block categories', () => {
  expect(contractActionCategory('Cancel subscription')).toBe('delete');
  expect(contractActionCategory('Kündigung des Vertrags bestätigen')).toBe('delete');
  expect(contractActionCategory('Delete domain')).toBe('delete');
  expect(contractActionCategory('Close account')).toBe('delete');
  expect(contractActionCategory('Enable automatic renewal')).toBe('pay');
  expect(contractActionCategory('Upgrade subscription')).toBe('pay');
  expect(contractActionCategory('Manage subscription')).toBeNull();
  expect(contractActionCategory('View contract details')).toBeNull();
});
