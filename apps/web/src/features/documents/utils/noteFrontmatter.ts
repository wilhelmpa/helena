export type Frontmatter = Record<string, unknown>;

// Obsidian accepts a list or one string of words; a leading "#" is not part of a tag.
export function noteTags(frontmatter: Frontmatter): string[] {
  const tags = frontmatter.tags;
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[,\s]+/) : [];
  return list.flatMap((tag) => {
    const cleaned = typeof tag === 'string' ? cleanTag(tag) : null;
    return cleaned ? [cleaned] : [];
  });
}

export function noteType(frontmatter: Frontmatter): string {
  return typeof frontmatter.type === 'string' ? frontmatter.type : '';
}

// A tag as the owner typed it: without "#", and a tag holds no spaces.
export function cleanTag(tag: string): string | null {
  const cleaned = tag.trim().replace(/^#+/, '').replace(/\s+/g, '-');
  return cleaned || null;
}

// The other properties stay as they are; an emptied property is removed.
export function withTags(frontmatter: Frontmatter, tags: string[]): Frontmatter {
  const { tags: _tags, ...rest } = frontmatter;
  return tags.length > 0 ? { ...frontmatter, tags } : rest;
}

export function withType(frontmatter: Frontmatter, type: string): Frontmatter {
  const { type: _type, ...rest } = frontmatter;
  const trimmed = type.trim();
  return trimmed ? { ...frontmatter, type: trimmed } : rest;
}
