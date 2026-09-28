const fixedFolders: Record<string, string> = {
  Docs: 'Dokumente',
  Files: 'Dateien',
  Assets: 'Anhänge',
  Boards: 'Leinwände',
  Inbox: 'Eingang',
};

const fixedOrder = ['Docs', 'Files', 'Assets', 'Boards', 'Inbox'];

export function knowledgeFolderLabel(name: string): string {
  return fixedFolders[name] ?? name;
}

export function compareKnowledgeFolders(a: string, b: string): number {
  const first = fixedOrder.indexOf(a);
  const second = fixedOrder.indexOf(b);
  if (first !== -1 || second !== -1) {
    if (first === -1) return 1;
    if (second === -1) return -1;
    return first - second;
  }
  return a.localeCompare(b, 'de');
}
