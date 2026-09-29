'use client';

import { useState, type ReactNode } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import type { StandingOrder, StandingOrderScope } from '@/lib/api/endpoints/standingOrders';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  ActionMenu,
  Button,
  Inline,
  Pill,
  SettingsGroup,
  SettingsRow,
  Stack,
  Switch,
  Text,
  TextArea,
} from '@/design-system';
import { useStandingOrderMutations, useStandingOrders } from '../services/standingOrders.service';
import { standingOrderGroups } from '../utils/standingOrders';

const MAX = 500;

// Dauerhafte Anweisungen (owner 28.09., OpenClaw's standing orders): rules the agents of a
// project — or Helena — follow in every run until they are switched off. An agent may
// propose one; it works only once confirmed here. Used in Projekt › Autopilot & Ausführung
// and, for Helena, in Vorgaben für Projekte.
export default function StandingOrdersGroup({
  scope,
  title,
  description,
  canEdit,
  children,
}: {
  scope: StandingOrderScope;
  title: ReactNode;
  description?: ReactNode;
  canEdit: boolean;
  // Rows of the same group before the orders (a project's standing instruction text).
  children?: ReactNode;
}) {
  const t = useTranslations('autopilot.standingOrders');
  const tCommon = useTranslations('common');
  const { data: session } = useSession();
  const query = useStandingOrders(scope);
  const mutations = useStandingOrderMutations(scope);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<StandingOrder | null>(null);
  const groups = standingOrderGroups(query.data ?? []);
  const fail = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t('failed'));

  const add = () => {
    const body = draft.trim();
    if (!body) return;
    mutations.create.mutate(
      { body, source: session?.user.name || t('sourceOwner') },
      {
        onSuccess: () => {
          setDraft('');
          toast.success(t('added'));
        },
        onError: fail,
      },
    );
  };

  return (
    <SettingsGroup title={title} description={description}>
      {children}
      {groups.proposed.map((order) => (
        <SettingsRow
          key={order.id}
          label={
            <Inline gap={2} wrap>
              <Pill tone="warning">{t('proposal')}</Pill>
              <span dir="auto">{order.body}</span>
            </Inline>
          }
          description={t('proposedBy', { source: order.source })}
        >
          {canEdit && (
            <Inline gap={2}>
              <Button
                size="small"
                variant="ghost"
                icon={<X size={14} />}
                disabled={mutations.decide.isPending}
                onClick={() =>
                  mutations.decide.mutate(
                    { id: order.id, approved: false },
                    { onSuccess: () => toast.success(t('rejected')), onError: fail },
                  )
                }
              >
                {t('reject')}
              </Button>
              <Button
                size="small"
                variant="primary"
                icon={<Check size={14} />}
                disabled={mutations.decide.isPending}
                onClick={() =>
                  mutations.decide.mutate(
                    { id: order.id, approved: true },
                    { onSuccess: () => toast.success(t('confirmed')), onError: fail },
                  )
                }
              >
                {t('confirm')}
              </Button>
            </Inline>
          )}
        </SettingsRow>
      ))}
      {groups.confirmed.map((order) => (
        <OrderRow
          key={order.id}
          order={order}
          canEdit={canEdit}
          busy={mutations.update.isPending}
          onToggle={(active) =>
            mutations.update.mutate(
              { id: order.id, patch: { active } },
              {
                onSuccess: () => toast.success(t(active ? 'switchedOn' : 'switchedOff')),
                onError: fail,
              },
            )
          }
          onSave={(body, done) =>
            mutations.update.mutate(
              { id: order.id, patch: { body } },
              {
                onSuccess: () => {
                  done();
                  toast.success(t('saved'));
                },
                onError: fail,
              },
            )
          }
          onDelete={() => setDeleting(order)}
        />
      ))}
      {canEdit && (
        <SettingsRow
          label={t('newLabel')}
          description={groups.confirmed.length === 0 ? t('empty') : undefined}
          htmlFor={`standing-order-new-${scope?.projectKey ?? 'helena'}`}
          stacked
        >
          <Stack gap={2}>
            <TextArea
              id={`standing-order-new-${scope?.projectKey ?? 'helena'}`}
              rows={2}
              maxLength={MAX}
              value={draft}
              placeholder={t('placeholder')}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Inline justify="end">
              <Button
                size="small"
                icon={<Plus size={14} />}
                disabled={!draft.trim() || mutations.create.isPending}
                onClick={add}
              >
                {mutations.create.isPending ? tCommon('saving') : t('add')}
              </Button>
            </Inline>
          </Stack>
        </SettingsRow>
      )}
      {deleting && (
        <ConfirmDialog
          title={t('deleteTitle')}
          confirmLabel={tCommon('delete')}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await mutations.remove.mutateAsync(deleting.id);
            setDeleting(null);
            toast.success(t('deleted'));
          }}
        >
          <Text size="sm" tone="muted" dir="auto">
            {deleting.body}
          </Text>
        </ConfirmDialog>
      )}
    </SettingsGroup>
  );
}

function OrderRow({
  order,
  canEdit,
  busy,
  onToggle,
  onSave,
  onDelete,
}: {
  order: StandingOrder;
  canEdit: boolean;
  busy: boolean;
  onToggle: (active: boolean) => void;
  onSave: (body: string, done: () => void) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('autopilot.standingOrders');
  const tCommon = useTranslations('common');
  const [editing, setEditing] = useState<string | null>(null);
  if (editing !== null)
    return (
      <SettingsRow label={t('editLabel')} htmlFor={`standing-order-${order.id}`} stacked>
        <Stack gap={2}>
          <TextArea
            id={`standing-order-${order.id}`}
            rows={2}
            maxLength={MAX}
            value={editing}
            onChange={(event) => setEditing(event.target.value)}
          />
          <Inline justify="end" gap={2}>
            <Button size="small" variant="ghost" onClick={() => setEditing(null)}>
              {tCommon('cancel')}
            </Button>
            <Button
              size="small"
              variant="primary"
              disabled={!editing.trim() || editing.trim() === order.body || busy}
              onClick={() => onSave(editing.trim(), () => setEditing(null))}
            >
              {tCommon('save')}
            </Button>
          </Inline>
        </Stack>
      </SettingsRow>
    );
  return (
    <SettingsRow
      label={
        <Text tone={order.active ? 'default' : 'muted'} dir="auto">
          {order.body}
        </Text>
      }
      description={t(order.active ? 'inForce' : 'off', { source: order.source })}
    >
      <Inline gap={2}>
        <Switch
          aria-label={t('active')}
          checked={order.active}
          disabled={!canEdit || busy}
          onCheckedChange={onToggle}
        />
        {canEdit && (
          <ActionMenu
            label={t('actions')}
            items={[
              {
                id: 'edit',
                label: t('edit'),
                icon: <Pencil size={14} />,
                onSelect: () => setEditing(order.body),
              },
              {
                id: 'delete',
                label: tCommon('delete'),
                icon: <Trash2 size={14} />,
                onSelect: onDelete,
                danger: true,
              },
            ]}
          />
        )}
      </Inline>
    </SettingsRow>
  );
}
