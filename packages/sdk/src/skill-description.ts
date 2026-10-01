export function truncateSkillDescription(value: string): string {
  if (value.length <= 300) return value;
  const code = value.charCodeAt(298);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? 298 : 299) + '…';
}

export function limitSkillMarkdownDescription(markdown: string): string {
  return markdown.replace(
    /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/,
    (_all, start, header, end) => {
      const bounded = header.replace(
        /^description[ \t]*:[ \t]*([^\r\n]*)(?:\r?\n[ \t]+[^\r\n]*)*/m,
        (field: string, scalar: string) => {
          let description = scalar.trim();
          if (/^[|>][+-]?$/.test(description)) {
            description = field
              .split(/\r?\n/)
              .slice(1)
              .map((line) => line.trim())
              .join(' ');
          } else if (description.startsWith('"') && description.endsWith('"')) {
            try {
              description = JSON.parse(description) as string;
            } catch {
              return field;
            }
          } else if (description.startsWith("'") && description.endsWith("'")) {
            description = description.slice(1, -1).replaceAll("''", "'");
          }
          return description.length <= 300
            ? field
            : `description: ${JSON.stringify(truncateSkillDescription(description))}`;
        },
      );
      return start + bounded + end;
    },
  );
}
