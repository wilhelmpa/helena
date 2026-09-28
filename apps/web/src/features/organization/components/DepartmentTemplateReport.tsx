'use client';

import { useTranslations } from 'next-intl';
import type { BundleReport } from '@/lib/api/endpoints/templateBundles';
import { Stack, Text } from '@/design-system';

// What a department template import would do (the dry run) or did: one summary line and
// the report's lines, as the team's template import shows them.
export default function DepartmentTemplateReport({
  report,
  dryRun,
}: {
  report: BundleReport;
  dryRun: boolean;
}) {
  const t = useTranslations('organization.departments');
  const counts = {
    written: report.written,
    unchanged: report.unchanged,
    drift: report.drift,
    warnings: report.warnings,
  };
  return (
    <Stack gap={2}>
      <Text as="p" size="sm" className="font-medium">
        {dryRun ? t('templatePreview', counts) : t('templateDone', counts)}
      </Text>
      <pre
        dir="ltr"
        className="max-h-64 overflow-auto rounded-md border bg-card p-2 text-xs whitespace-pre-wrap"
      >
        {report.lines.join('\n').trim()}
      </pre>
    </Stack>
  );
}
