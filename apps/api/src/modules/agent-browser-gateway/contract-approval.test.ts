import { expect, test } from 'bun:test';
import {
  browserApprovalCommand,
  renewalDomainApproved,
  renewalDomainInPath,
} from './contract-approval';

test('a Squarespace approval is limited to the exact domain and renewal cancellation', () => {
  const action = 'Squarespace-Kündigung für bumbleandthebees.com ausführen';
  const path = '/domains/bumbleandthebees.com/billing';
  const control = 'Disable automatic renewal of bumbleandthebees.com';
  expect(renewalDomainApproved(action, path, control)).toBe(true);
  expect(renewalDomainApproved(action, '/domains/bumbleandthebee.com/billing', control)).toBe(
    false,
  );
  expect(renewalDomainApproved(action, path, 'Delete the whole domain')).toBe(false);
  expect(renewalDomainApproved(action, path, 'Enable automatic renewal')).toBe(false);
  expect(renewalDomainApproved(action + ' and other.com', path, control)).toBe(false);
});

test('the URL path supplies exactly one domain and never its query', () => {
  expect(renewalDomainInPath('/domains/bumbleandthebees.com/settings')).toBe(
    'bumbleandthebees.com',
  );
  expect(renewalDomainInPath('/domains/bumbleandthebees.com/other.com')).toBeNull();
  expect(renewalDomainInPath('/domains/no-domain')).toBeNull();
  expect(renewalDomainInPath('/domains/%ZZ')).toBeNull();
});

test('new browser approvals bind the observed control and domain path', () => {
  const target = {
    tool: 'browser_click',
    origin: 'https://account.squarespace.com',
    pagePath: '/domains/bumbleandthebees.com',
    groundedElement: 'Disable automatic renewal',
  };
  const command = browserApprovalCommand('delete', target);
  expect(command).toBeTruthy();
  expect(browserApprovalCommand('delete', { ...target, pagePath: '/domains/other.com' })).not.toBe(
    command,
  );
  expect(browserApprovalCommand('pay', target)).not.toBe(command);
  expect(browserApprovalCommand('delete', { ...target, groundedElement: null })).toBeNull();
});
