import { expect, it } from 'bun:test';
import { priorityProxyBaseUrl } from './halogen-priority';

it('keeps local Whisper on its on-demand proxy socket', () => {
  expect(priorityProxyBaseUrl('http://127.0.0.1:13306/v1')).toBe('http://127.0.0.1:13306/v1');
  expect(priorityProxyBaseUrl('http://localhost:13306/v1')).toBe('http://localhost:13306/v1');
  expect(priorityProxyBaseUrl('http://127.0.0.1:8733/v1')).toBe('http://127.0.0.1:8743/v1');
});
