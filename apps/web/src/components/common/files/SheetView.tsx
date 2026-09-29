'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Table2 } from 'lucide-react';
import { EmptyState, Inline, Segmented, Stack, Table, Td, Text, Th, Tr } from '@/design-system';

export interface SheetData {
  name: string;
  // Row by row, the first row is the head.
  rows: string[][];
  // The source held more than it gave (the converter cut it).
  truncated?: boolean;
}

export const SHEET_MAX_ROWS = 500;
export const SHEET_MAX_COLUMNS = 60;

// A table as the sheets of a spreadsheet or the rows of a CSV: the sheets as tabs when
// there are several, the first row as the head, and a line that says when only the first
// rows and columns are shown. Long tables scroll inside the one surface.
export default function SheetView({ sheets }: { sheets: SheetData[] }) {
  const t = useTranslations('files.viewer');
  const [active, setActive] = useState(0);
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  if (!sheet || sheet.rows.length === 0)
    return <EmptyState icon={<Table2 />}>{t('sheetEmpty')}</EmptyState>;
  const [head = [], ...body] = sheet.rows;
  const columns = Math.min(
    SHEET_MAX_COLUMNS,
    Math.max(head.length, ...body.map((row) => row.length)),
  );
  const shown = body.slice(0, SHEET_MAX_ROWS);
  const cut =
    sheet.truncated ||
    body.length > SHEET_MAX_ROWS ||
    Math.max(head.length, ...body.map((row) => row.length)) > SHEET_MAX_COLUMNS;
  const cells = (row: string[]) => Array.from({ length: columns }, (_, index) => row[index] ?? '');
  return (
    <Stack gap={2} className="ds-file-sheet">
      {sheets.length > 1 && (
        <Inline gap={2} className="ds-file-sheet-tabs">
          <Segmented
            label={t('sheets')}
            value={String(Math.min(active, sheets.length - 1))}
            onChange={(next) => setActive(Number(next))}
            options={sheets.map((item, index) => ({ value: String(index), label: item.name }))}
          />
        </Inline>
      )}
      <div className="ds-file-sheet-scroll">
        <Table stack={false} label={sheet.name}>
          <thead>
            <tr>
              {cells(head).map((cell, index) => (
                <Th key={index}>{cell}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => (
              <Tr key={rowIndex}>
                {cells(row).map((cell, index) => (
                  <Td key={index}>{cell}</Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      {cut && (
        <Text size="xs" tone="muted">
          {t('sheetTruncated', { rows: SHEET_MAX_ROWS, columns: SHEET_MAX_COLUMNS })}
        </Text>
      )}
    </Stack>
  );
}
