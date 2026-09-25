'use client';

import { useDeferredValue, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCheck,
  CircleDot,
  Download,
  FileUp,
  FolderOpen,
  Landmark,
  ListChecks,
  Upload,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import SectionPageView from '@/components/common/page/SectionPageView';
import { EmptyState } from '@/components/common/page/EmptyState';
import {
  PageActions,
  PageSearch,
  PageSelect,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import VaultFilePicker from '@/features/mail/components/VaultFilePicker';
import { ApiError } from '@/lib/api/core/client';
import { downloadMonthExport, type ReviewItem } from '@/lib/api/endpoints/receipts';
import { AccountsTab } from './components/AccountsTab';
import { ImportDialog } from './components/ImportDialog';
import { MatchedTab } from './components/MatchedTab';
import { OpenTab } from './components/OpenTab';
import { ReceiptSheet } from './components/ReceiptSheet';
import { ReviewTab } from './components/ReviewTab';
import {
  useBankAccountsQuery,
  useImportsQuery,
  useReceiptFromVault,
  useReceiptsQuery,
  useReceiptSummaryQuery,
  useReviewQuery,
  useTransactionsQuery,
  useUploadReceipt,
} from './services/receipts.service';
import { formatMonth, saveBlob } from './utils/format';

export type ReceiptsTab = 'open' | 'review' | 'matched' | 'accounts';

const ALL_MONTHS = 'all';
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.xml';

function matchesSearch(item: ReviewItem, q: string): boolean {
  const text = [
    item.receipt.issuer,
    item.receipt.invoiceNumber,
    item.receipt.filename,
    item.transaction.counterpartyName,
    item.transaction.purpose,
  ]
    .join(' ')
    .toLowerCase();
  return text.includes(q.toLowerCase());
}

// A project's receipts (Belege, docs/helena-decisions/decisions.md §7): what is still open
// on either side, the matches waiting for the owner, what is matched, and the bank accounts
// with their statement imports. One toolbar row: the four views, the month, the search, the
// statement import and the month's export, and "Beleg hochladen". Finance data: the page is
// for the project's administrators only, as its routes are.
export default function ReceiptsPage() {
  const t = useTranslations('receipts');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { project } = useShell();
  const { isAdmin } = usePermissions();
  const projectKey = project?.project.key ?? '';
  const enabled = !!projectKey && isAdmin;

  const [tab, setTab] = useState<ReceiptsTab>('open');
  const [month, setMonth] = useState<string>(ALL_MONTHS);
  const [search, setSearch] = useState('');
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [importFor, setImportFor] = useState<{ accountId: number | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useUploadReceipt(projectKey);
  const fromVault = useReceiptFromVault(projectKey);
  const [vaultOpen, setVaultOpen] = useState(false);

  const deferred = useDeferredValue(search.trim());
  const monthFilter = month === ALL_MONTHS ? undefined : month;
  const q = deferred || undefined;
  const summary = useReceiptSummaryQuery(projectKey, monthFilter, enabled);
  const accounts = useBankAccountsQuery(projectKey, enabled);
  const openReceipts = useReceiptsQuery(
    projectKey,
    { status: 'open', month: monthFilter, q },
    enabled && tab === 'open',
  );
  const openTransactions = useTransactionsQuery(
    projectKey,
    { status: 'open', month: monthFilter, q },
    enabled && tab === 'open',
  );
  const ignored = useTransactionsQuery(
    projectKey,
    { status: 'ignored', month: monthFilter, q },
    enabled && tab === 'open',
  );
  const review = useReviewQuery(projectKey, monthFilter, enabled && tab === 'review');
  const matched = useReceiptsQuery(
    projectKey,
    { status: 'matched', month: monthFilter, q },
    enabled && tab === 'matched',
  );
  const imports = useImportsQuery(projectKey, enabled && tab === 'accounts');

  if (!project) return null;
  if (!isAdmin) {
    return (
      <SectionPageView title={tNav('receipts')}>
        <EmptyState title={t('noAccessTitle')} description={t('noAccessHint')} />
      </SectionPageView>
    );
  }

  const counts = summary.data;
  const months = counts?.months ?? [];
  const monthOptions = [
    { value: ALL_MONTHS, label: t('allMonths') },
    ...(month !== ALL_MONTHS && !months.includes(month) ? [month] : []).map((value) => ({
      value,
      label: formatMonth(value, locale),
    })),
    ...months.map((value) => ({ value, label: formatMonth(value, locale) })),
  ];

  async function uploadFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (fileInput.current) fileInput.current.value = '';
    let done = 0;
    let matchedNow = 0;
    for (const file of list) {
      try {
        const receipt = await upload.mutateAsync(file);
        done += 1;
        if (receipt.status === 'matched') matchedNow += 1;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409)
          toast.info(t('upload.duplicate', { name: file.name }));
        else toast.error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (done)
      toast.success(
        matchedNow
          ? t('upload.doneMatched', { count: done, matched: matchedNow })
          : t('upload.done', { count: done }),
      );
  }

  // A file already in the project's folder becomes a receipt where it is; nothing is copied.
  async function takeFromVault(projectPath: string) {
    setVaultOpen(false);
    const name = projectPath.split('/').pop() ?? projectPath;
    try {
      const receipt = await fromVault.mutateAsync(projectPath);
      toast.success(
        receipt.status === 'matched'
          ? t('upload.doneMatched', { count: 1, matched: 1 })
          : t('upload.done', { count: 1 }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409)
        toast.info(t('upload.duplicate', { name }));
      else toast.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function exportMonth() {
    if (month === ALL_MONTHS) return;
    setExporting(true);
    try {
      saveBlob(
        await downloadMonthExport(projectKey, month),
        `Helena-Belege_${projectKey}_${month}.zip`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  const accountList = accounts.data ?? [];
  const reviewItems = (review.data ?? []).filter((item) => !q || matchesSearch(item, q));

  return (
    <>
      <PageToolbar>
        <PageTabs<ReceiptsTab>
          label={tNav('receipts')}
          value={tab}
          onChange={setTab}
          items={[
            {
              value: 'open',
              label: t('tabs.open'),
              icon: CircleDot,
              count: counts ? counts.receipts.open + counts.transactions.open : undefined,
            },
            {
              value: 'review',
              label: t('tabs.review'),
              icon: ListChecks,
              count: counts?.proposals,
            },
            {
              value: 'matched',
              label: t('tabs.matched'),
              icon: CheckCheck,
              count: counts?.receipts.matched,
            },
            {
              value: 'accounts',
              label: t('tabs.accounts'),
              icon: Landmark,
              count: accounts.data?.length,
            },
          ]}
        />
        <PageToolbarSpacer />
        <PageSelect
          label={t('month')}
          icon={CalendarDays}
          value={month}
          defaultValue={ALL_MONTHS}
          onChange={setMonth}
          options={monthOptions}
        />
        <PageSearch value={search} onChange={setSearch} placeholder={t('search')} />
        <PageActions
          actions={[
            {
              id: 'import',
              label: t('actions.import'),
              icon: FileUp,
              onClick: () => setImportFor({ accountId: accountList[0]?.id ?? null }),
            },
            {
              id: 'fromVault',
              label: t('actions.fromVault'),
              icon: FolderOpen,
              disabled: fromVault.isPending,
              onClick: () => setVaultOpen(true),
            },
            {
              id: 'export',
              label: month === ALL_MONTHS ? t('actions.exportPickMonth') : t('actions.export'),
              icon: Download,
              disabled: month === ALL_MONTHS || exporting,
              onClick: () => void exportMonth(),
            },
          ]}
          primary={{
            id: 'upload',
            label: t('actions.upload'),
            icon: Upload,
            disabled: upload.isPending,
            onClick: () => fileInput.current?.click(),
          }}
        />
      </PageToolbar>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => void uploadFiles(event.target.files)}
      />
      <SectionPageView title={tNav('receipts')} wide>
        {tab === 'open' && (
          <OpenTab
            projectKey={projectKey}
            receipts={openReceipts.data ?? []}
            transactions={openTransactions.data ?? []}
            ignored={ignored.data ?? []}
            loading={openReceipts.isPending || openTransactions.isPending}
            onOpenReceipt={setReceiptId}
          />
        )}
        {tab === 'review' && (
          <ReviewTab
            projectKey={projectKey}
            items={reviewItems}
            loading={review.isPending}
            onOpenReceipt={setReceiptId}
          />
        )}
        {tab === 'matched' && (
          <MatchedTab
            projectKey={projectKey}
            receipts={matched.data ?? []}
            loading={matched.isPending}
            onOpenReceipt={setReceiptId}
          />
        )}
        {tab === 'accounts' && (
          <AccountsTab
            projectKey={projectKey}
            accounts={accountList}
            imports={imports.data ?? []}
            loading={accounts.isPending || imports.isPending}
            onImport={(accountId) => setImportFor({ accountId })}
          />
        )}
      </SectionPageView>
      {vaultOpen && (
        <VaultFilePicker
          projectKey={projectKey}
          title={t('vaultPicker.title')}
          description={t('vaultPicker.description')}
          onClose={() => setVaultOpen(false)}
          onPick={(_vaultPath, projectPath) => void takeFromVault(projectPath)}
        />
      )}
      <ReceiptSheet
        projectKey={projectKey}
        receiptId={receiptId}
        onClose={() => setReceiptId(null)}
      />
      {importFor && (
        <ImportDialog
          projectKey={projectKey}
          accounts={accountList}
          initialAccountId={importFor.accountId}
          onClose={() => setImportFor(null)}
        />
      )}
    </>
  );
}
