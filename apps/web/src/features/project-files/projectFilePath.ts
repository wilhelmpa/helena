export function projectFileParent(path: string) {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function projectFileChild(path: string, name: string) {
  return [path, name].filter(Boolean).join('/');
}
