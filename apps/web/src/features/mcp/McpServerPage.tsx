'use client';

import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import SectionPageView from '@/components/common/page/SectionPageView';
import { PageTabs, PageToolbar } from '@/components/layout/PageToolbar';
import McpAccessNotice from './components/McpAccessNotice';
import McpAuthConfiguration, { type McpMethod } from './components/McpAuthConfiguration';

// The project's MCP server: how a client connects to it. The two methods (OAuth, a
// personal API key) are the page's tabs in the header row.
export default function McpServerPage() {
  const t = useTranslations('mcp');
  const { project } = useShell();
  const [method, setMethod] = useState<McpMethod>('oauth');
  const detail = project?.project ?? null;
  const reachable = detail != null && detail.mcpEnabled && detail.teamMcpEnabled;

  return (
    <SectionPageView title={t('title')} description={t('description')}>
      {reachable && (
        <PageToolbar>
          <PageTabs
            label={t('oauth.methodTabsAria')}
            value={method}
            onChange={setMethod}
            items={[
              { value: 'oauth', label: t('oauth.method'), icon: ShieldCheck },
              { value: 'api-key', label: t('oauth.personalKey'), icon: KeyRound },
            ]}
          />
        </PageToolbar>
      )}
      <div className="space-y-6">
        {detail && !reachable && (
          <McpAccessNotice
            teamId={detail.teamId}
            teamName={detail.teamName}
            teamRole={project?.viewer.teamRole ?? null}
            teamMcpEnabled={detail.teamMcpEnabled}
          />
        )}
        {reachable && <McpAuthConfiguration method={method} />}
      </div>
    </SectionPageView>
  );
}
