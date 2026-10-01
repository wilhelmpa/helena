import { expect, it } from 'bun:test';
import { localAiRegistrationSlug } from '../local-ai-registration';

it('registers Lemonade separately when local belongs to the embedding server', () => {
  expect(localAiRegistrationSlug('lemonade', 'openai-compatible')).toBe('volition-lemonade');
});

it('preserves an existing Lemonade registration', () => {
  expect(localAiRegistrationSlug('lemonade', 'lemonade')).toBe('local');
});

it('uses the existing default for a first installation', () => {
  expect(localAiRegistrationSlug('lemonade', null)).toBe('local');
});

it('keeps Halogen separate from local', () => {
  expect(localAiRegistrationSlug('halogen', 'openai-compatible')).toBe('halogen');
});
