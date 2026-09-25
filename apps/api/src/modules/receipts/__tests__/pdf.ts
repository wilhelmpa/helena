// A minimal PDF for the tests: one page of Helvetica text lines, optionally with embedded
// files in the document's EmbeddedFiles name tree, the way ZUGFeRD and Factur-X carry their
// XML. Built as a string with correct byte offsets, so poppler (pdftotext, pdfdetach) reads it
// without repairing it. Only ASCII in the page text; attachments may be any UTF-8.

function escapeText(text: string): string {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

export function makePdf(lines: string[], attachments: { name: string; content: string }[] = []) {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const byteLength = (text: string) => Buffer.byteLength(text, 'utf8');

  const catalog = add('');
  const pages = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const stream = [
    'BT',
    '/F1 11 Tf',
    '14 TL',
    '50 800 Td',
    ...lines.map((line) => `(${escapeText(line)}) Tj T*`),
    'ET',
  ].join('\n');
  const content = add(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  const page = add(
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
  );
  objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;

  const names: string[] = [];
  for (const attachment of attachments) {
    const file = add(
      `<< /Type /EmbeddedFile /Subtype /text#2Fxml /Length ${byteLength(attachment.content)} >>\n` +
        `stream\n${attachment.content}\nendstream`,
    );
    const spec = add(
      `<< /Type /Filespec /F (${escapeText(attachment.name)}) /UF (${escapeText(attachment.name)}) ` +
        `/EF << /F ${file} 0 R >> >>`,
    );
    names.push(`(${escapeText(attachment.name)}) ${spec} 0 R`);
  }
  objects[catalog - 1] =
    `<< /Type /Catalog /Pages ${pages} 0 R` +
    (names.length ? ` /Names << /EmbeddedFiles << /Names [${names.join(' ')}] >> >>` : '') +
    ' >>';

  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}
