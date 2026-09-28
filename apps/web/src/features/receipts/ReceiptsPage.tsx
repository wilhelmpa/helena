'use client';

import { useDeferredValue, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  CircleSlash,
  Download,
  FileUp,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Undo2,
  Upload,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MonoLabel } from '@/components/helena/DashboardPrimitives';
import KnowledgeFrame, {
  KnowledgeListHead,
  KnowledgeRow,
  KnowledgeSearch,
  useListKeyboard,
  type KnowledgeCrumb,
} from '@/components/helena/KnowledgeFrame';
import PillButton from '@/components/helena/PillButton';
import VaultFilePicker from '@/features/mail/components/VaultFilePicker';
import { ApiError } from '@/lib/api/core/client';
import {
  downloadMonthExport,
  type Receipt,
  type ReviewItem,
  type Transaction,
} from '@/lib/api/endpoints/receipts';
import { filesPath, receiptsPath } from '@/utils/paths';
import { AccountsTab } from './components/AccountsTab';
import { ImportDialog } from './components/ImportDialog';
import ReceiptPreview from './components/ReceiptPreview';
import { ReviewTab } from './components/ReviewTab';
import { receiptIcon, receiptSignedCents } from './components/ReceiptRows';
import {
  useBankAccountsQuery,
  useImportsQuery,
  useReceiptFromVault,
  useReceiptsQuery,
  useReceiptSummaryQuery,
  useReviewQuery,
  useTransactionsQuery,
  useUpdateTransaction,
  useUploadReceipt,
} from './services/receipts.service';
import { formatCents, formatDay, formatMonth, saveBlob } from './utils/format';

export type ReceiptsView = 'all' | 'open' | 'review' | 'matched' | 'accounts';
const VIEWS: ReceiptsView[] = ['all', 'open', 'review', 'matched', 'accounts'];

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

// A project's receipts (Belege, docs/helena-decisions/decisions.md §7) in the Wissen
// pattern (docs/ui-system.md §13): the sidebar tree picks the view (all, open, to review,
// matched, accounts), the page lists it, and the selected receipt shows on the right —
// its file and its detail — without a second row of tabs. Finance data: the page is for
// the project's administrators only, as its routes are.
export default function ReceiptsPage() {
  const t = useTranslations('receipts');
  const tNav = useTranslations('nav');
  const tFiles = useTranslations('files');
  const locale = useLocale();
  const params = useSearchParams();
  const { project } = useShell();
  const { isAdmin } = usePermissions();
  const projectKey = project?.project.key ?? '';
  const enabled = !!projectKey && isAdmin;
  const requested = params.get('view') as ReceiptsView | null;
  const view: ReceiptsView = requested && VIEWS.includes(requested) ? requested : 'all';

  const [month, setMonth] = useState<string>(ALL_MONTHS);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [importFor, setImportFor] = useState<{ accountId: number | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useUploadReceipt(projectKey);
  const fromVault = useReceiptFromVault(projectKey);
  const updateTransaction = useUpdateTransaction(projectKey);
  const [vaultOpen, setVaultOpen] = useState(false);

  const deferred = useDeferredValue(search.trim());
  const monthFilter = month === ALL_MONTHS ? undefined : month;
  const q = deferred || undefined;
  const summary = useReceiptSummaryQuery(projectKey, monthFilter, enabled);
  const accounts = useBankAccountsQuery(projectKey, enabled);
  const listed = useReceiptsQuery(
    projectKey,
    {
      status: view === 'open' ? 'open' : view === 'matched' ? 'matched' : undefined,
      month: monthFilter,
      q,
    },
    enabled && (view === 'all' || view === 'open' || view === 'matched'),
  );
  const openTransactions = useTransactionsQuery(
    projectKey,
    { status: 'open', month: monthFilter, q },
    enabled && view === 'open',
  );
  const ignored = useTransactionsQuery(
    projectKey,
    { status: 'ignored', month: monthFilter, q },
    enabled && view === 'open',
  );
  const review = useReviewQuery(projectKey, monthFilter, enabled && view === 'review');
  const imports = useImportsQuery(projectKey, enabled && view === 'accounts');

  const receipts: Receipt[] = listed.data ?? [];
  const selected =
    view === 'review' || view === 'accounts'
      ? selectedId
      : (receipts.find((receipt) => receipt.id === selectedId)?.id ?? receipts[0]?.id ?? null);
  const selectedIndex = receipts.findIndex((receipt) => receipt.id === selected);
  const keyboard = useListKeyboard({
    count: receipts.length,
    selected: selectedIndex,
    onSelect: (index) => setSelectedId(receipts[index]?.id ?? null),
    onOpen: (index) => setSelectedId(receipts[index]?.id ?? null),
  });

  if (!project) return null;
  const crumbs: KnowledgeCrumb[] = [
    { label: project.project.name },
    { label: tFiles('roots.vault'), href: filesPath(projectKey) },
    ...(view === 'all' ? [] : [{ label: tNav('receipts'), href: receiptsPath(projectKey) }]),
  ];
  const title = view === 'all' ? tNav('receipts') : t(`tabs.${view}`);

  if (!isAdmin) {
    return (
      <KnowledgeFrame crumbs={crumbs} title={tNav('receipts')}>
        <p className="text-sm text-muted-foreground">{t('noAccessHint')}</p>
      </KnowledgeFrame>
    );
  }

  const counts = summary.data;
  const months = counts?.months ?? [];
  const monthOptions = [
    ...(month !== ALL_MONTHS && !months.includes(month) ? [month] : []),
    ...months,
  ];

  async function uploadFiles(files: FileList | File[] | null) {
    const list = Array.from(files ?? []);
    if (fileInput.current) fileInput.current.value = '';
    let done = 0;
    let matchedNow = 0;
    for (const file of list) {
      try {
        const receipt = await upload.mutateAsync(file);
        done += 1;
        if (receipt.status === 'matched') matchedNow += 1;
        setSelectedId(receipt.id);
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
      setSelectedId(receipt.id);
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

  const receiptRow = (receipt: Receipt, index: number) => {
    const detail = [
      (receipt.originalCount ?? 1) > 1
        ? t('originals.count', { count: receipt.originalCount! })
        : null,
      receipt.invoiceNumber,
      formatDay(receipt.invoiceDate, locale),
      receipt.creditNote ? t('creditNote') : null,
      view === 'all' ? t(`status.${receipt.status}`) : null,
      view === 'matched' && receipt.match
        ? `${t(`method.${receipt.match.method}`)} · ${formatDay(receipt.match.bookingDate, locale)}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const cents = receiptSignedCents(receipt);
    return (
      <KnowledgeRow
        key={receipt.id}
        index={index}
        icon={receiptIcon(receipt)}
        name={receipt.issuer ?? receipt.filename}
        title={receipt.filename}
        detail={detail}
        trailing={
          <span
            className={
              cents === null
                ? 'text-muted-foreground'
                : cents < 0
                  ? 'text-foreground'
                  : 'text-status-success'
            }
          >
            {formatCents(cents, receipt.currency, locale)}
          </span>
        }
        selected={selected === receipt.id}
        onClick={() => setSelectedId(receipt.id)}
      />
    );
  };
  const transactionRow = (transaction: Transaction, ignoredRow: boolean) => (
    <KnowledgeRow
      key={transaction.id}
      icon={transaction.amountCents < 0 ? ArrowUpRight : ArrowDownLeft}
      name={transaction.counterpartyName || t('noName')}
      title={transaction.purpose}
      detail={[
        formatDay(transaction.bookingDate, locale),
        transaction.accountName,
        transaction.purpose,
      ]
        .filter(Boolean)
        .join(' · ')}
      trailing={
        <>
          <span className={transaction.amountCents < 0 ? 'text-foreground' : 'text-status-success'}>
            {formatCents(transaction.amountCents, transaction.currency, locale)}
          </span>
          <button
            type="button"
            aria-label={ignoredRow ? t('open.undoIgnore') : t('open.noReceiptNeeded')}
            title={ignoredRow ? t('open.undoIgnore') : t('open.noReceiptNeeded')}
            disabled={updateTransaction.isPending}
            onClick={() =>
              updateTransaction.mutate({
                transactionId: transaction.id,
                patch: { status: ignoredRow ? 'open' : 'ignored' },
              })
            }
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {ignoredRow ? <Undo2 size={14} /> : <CircleSlash size={14} />}
          </button>
        </>
      }
    />
  );

  const list = (
    <div
      ref={keyboard.ref}
      onKeyDown={keyboard.onKeyDown}
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
    >
      {listed.isPending ? (
        <p role="status" className="px-3.5 py-3 text-xs text-muted-foreground">
          {t('detail.loading')}
        </p>
      ) : receipts.length ? (
        receipts.map(receiptRow)
      ) : (
        <p className="px-3.5 py-3 text-sm text-muted-foreground">
          {view === 'open'
            ? t('open.noReceipts')
            : view === 'matched'
              ? t('matched.emptyHint')
              : t('emptyAll')}
        </p>
      )}
    </div>
  );

  const body =
    view === 'review' ? (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ReviewTab
          projectKey={projectKey}
          items={reviewItems}
          loading={review.isPending}
          onOpenReceipt={setSelectedId}
        />
      </div>
    ) : view === 'accounts' ? (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AccountsTab
          projectKey={projectKey}
          accounts={accountList}
          imports={imports.data ?? []}
          loading={accounts.isPending || imports.isPending}
          onImport={(accountId) => setImportFor({ accountId })}
        />
      </div>
    ) : view === 'open' ? (
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <section className="flex flex-col gap-2">
          <MonoLabel className="px-3.5">
            {`${t('open.receipts')} · ${receipts.length}`}
          </MonoLabel>
          {list}
        </section>
        <section className="flex flex-col gap-2">
          <MonoLabel className="px-3.5">
            {`${t('open.transactions')} · ${openTransactions.data?.length ?? 0}`}
          </MonoLabel>
          {(openTransactions.data ?? []).length ? (
            (openTransactions.data ?? []).map((transaction) => transactionRow(transaction, false))
          ) : (
            <p className="px-3.5 text-sm text-muted-foreground">{t('open.noTransactions')}</p>
          )}
        </section>
        {(ignored.data ?? []).length > 0 && (
          <section className="flex flex-col gap-2">
            <MonoLabel className="px-3.5">
              {`${t('open.ignored')} · ${ignored.data!.length}`}
            </MonoLabel>
            {ignored.data!.map((transaction) => transactionRow(transaction, true))}
          </section>
        )}
      </div>
    ) : (
      <>
        <KnowledgeListHead
          name={t('columns.name')}
          kind={t('columns.detail')}
          trailing={t('columns.amount')}
        />
        {list}
      </>
    );

  return (
    <>
      <KnowledgeFrame
        crumbs={crumbs}
        title={title}
        frameProps={{ 'data-receipts': view }}
        search={
          view !== 'accounts' && (
            <KnowledgeSearch value={search} onChange={setSearch} placeholder={t('search')} />
          )
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <PillButton className="h-8 min-h-8 shrink-0 gap-1 px-3">
                  <Plus size={14} aria-hidden="true" />
                  {t('new')}
                </PillButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem
                  disabled={upload.isPending}
                  onSelect={() => fileInput.current?.click()}
                >
                  <Upload />
                  {t('actions.upload')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={fromVault.isPending}
                  onSelect={() => setVaultOpen(true)}
                >
                  <FolderOpen />
                  {t('actions.fromVault')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setImportFor({ accountId: accountList[0]?.id ?? null })}
                >
                  <FileUp />
                  {t('actions.import')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('more')}
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
                >
                  <MoreHorizontal size={17} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  disabled={month === ALL_MONTHS || exporting}
                  onSelect={() => void exportMonth()}
                >
                  <Download />
                  {month === ALL_MONTHS ? t('actions.exportPickMonth') : t('actions.export')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        pills={
          view !== 'accounts' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('month')}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${month === ALL_MONTHS ? 'bg-muted text-muted-foreground hover:text-foreground' : 'bg-accent text-accent-foreground'}`}
                >
                  <CalendarDays size={13} aria-hidden="true" />
                  {month === ALL_MONTHS ? t('allMonths') : formatMonth(month, locale)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 w-48 overflow-y-auto">
                {[ALL_MONTHS, ...monthOptions].map((value) => (
                  <DropdownMenuItem key={value} onSelect={() => setMonth(value)}>
                    <Check className={month === value ? 'opacity-100' : 'opacity-0'} />
                    {value === ALL_MONTHS ? t('allMonths') : formatMonth(value, locale)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
        footer={
          (view === 'all' || view === 'open') && (
            <button
              type="button"
              data-knowledge-dropzone=""
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes('Files')) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.files.length) return;
                event.preventDefault();
                void uploadFiles(event.dataTransfer.files);
              }}
              className="mt-auto flex min-h-16 shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-[repeating-linear-gradient(135deg,var(--kanban-column)_0_10px,var(--kanban-column-raised)_10px_20px)] px-4 text-xs text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]"
            >
              <Upload size={14} aria-hidden="true" />
              <span>
                {t.rich('dropHint', {
                  pick: (chunks) => <span className="text-brand">{chunks}</span>,
                })}
              </span>
            </button>
          )
        }
        preview={
          selected !== null && view !== 'accounts' ? (
            <ReceiptPreview
              key={selected}
              projectKey={projectKey}
              receiptId={selected}
              onOpenReceipt={setSelectedId}
              onDeleted={() => setSelectedId(null)}
            />
          ) : undefined
        }
        previewLabel={t('detail.title')}
      >
        {body}
      </KnowledgeFrame>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => void uploadFiles(event.target.files)}
      />
      {vaultOpen && (
        <VaultFilePicker
          projectKey={projectKey}
          title={t('vaultPicker.title')}
          description={t('vaultPicker.description')}
          onClose={() => setVaultOpen(false)}
          onPick={(_vaultPath, projectPath) => void takeFromVault(projectPath)}
        />
      )}
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
