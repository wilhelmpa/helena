import { expect, test } from 'bun:test';
import { limitSkillMarkdownDescription, truncateSkillDescription } from '../skill-description';

test('limits descriptions including surrogate pairs with an ellipsis', () => {
  expect(truncateSkillDescription('x'.repeat(300))).toBe('x'.repeat(300));
  expect(truncateSkillDescription('x'.repeat(389))).toBe('x'.repeat(299) + '…');
  expect(truncateSkillDescription('x'.repeat(298) + '😀xx')).toBe('x'.repeat(298) + '…');
});

test('bounds plain, quoted and block frontmatter while preserving the body', () => {
  const description = 'x'.repeat(389);
  for (const value of [
    description,
    JSON.stringify(description),
    `'${description}'`,
    `>\n  ${description}`,
  ]) {
    expect(
      limitSkillMarkdownDescription(`---\nname: recovery\ndescription: ${value}\n---\nBody`),
    ).toBe(`---\nname: recovery\ndescription: "${'x'.repeat(299)}…"\n---\nBody`);
  }
  const short = '---\nname: recovery\ndescription: short\n---\nBody';
  expect(limitSkillMarkdownDescription(short)).toBe(short);
  expect(limitSkillMarkdownDescription('description: ' + description)).toBe(
    'description: ' + description,
  );
});
