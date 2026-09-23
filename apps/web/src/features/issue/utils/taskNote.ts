// Characters Obsidian does not allow in a file name, and the ones Markdown links read
// as syntax.
const UNSAFE = /[\\/:*?"<>|#^[\]]/g;

// Where a new note about a task is created: the project's Docs folder, named after the
// task.
export function taskNotePath(projectKey: string, identifier: string, title: string): string {
  const name = `${identifier} ${title.replace(UNSAFE, ' ')}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/^\.+/, '');
  return `Projects/${projectKey}/Docs/${name}.md`;
}
