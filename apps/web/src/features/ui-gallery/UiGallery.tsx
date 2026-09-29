'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bot,
  CircleAlert,
  FileText,
  Inbox,
  OctagonAlert,
  Plus,
  Settings2,
  Target,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  DetailGroup,
  DetailHeader,
  DetailView,
  Dialog,
  EmptyState,
  Field,
  Grid,
  IconButton,
  Inline,
  List,
  ListGroup,
  ListRow,
  MonoLabel,
  Notice,
  Orb,
  Pill,
  PillButton,
  Property,
  PropertyGrid,
  SearchField,
  Section,
  Segmented,
  SettingsGroup,
  SettingsRow,
  Stack,
  StatusDot,
  StatusPill,
  Table,
  Tabs,
  Td,
  Text,
  TextArea,
  TextField,
  Th,
  Tip,
  TimeSeriesChart,
  Tr,
  type Space,
  StatusBox,
} from '@/design-system';
import { HELENA_STATUSES } from '@/utils/helenaStatus';

// The living documentation of the UI framework (docs/ui-framework.md): every building
// block with its variants, light and dark side by side. A page of Helena's settings
// (Entwicklung › UI-Bausteine); the screenshots of the acceptance are taken here.
// Component names are code identifiers and stay untranslated; the sample texts come from
// the message files.

const SPACES: Space[] = [1, 2, 3, 4, 5, 6, 7];
const RADII = ['sm', 'md', 'lg', 'xl', 'full'] as const;
const SURFACES = ['bg', 'surface-1', 'surface-2', 'surface-3', 'accent', 'primary-bg'] as const;

function Specimen({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Stack gap={2}>
      <MonoLabel>{name}</MonoLabel>
      <Inline gap={3} wrap align="center">
        {children}
      </Inline>
    </Stack>
  );
}

function Blocks() {
  const t = useTranslations('settings.uiGallery');
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  const [segment, setSegment] = useState<'tree' | 'circle'>('tree');
  const [dialog, setDialog] = useState(false);
  const sample = t('sample');
  return (
    <Stack gap={6}>
      <Section title={t('tokens')}>
        <Stack gap={4}>
          <Specimen name="surface / text">
            {SURFACES.map((token) => (
              <span key={token} className="ds-gallery-swatch" data-token={token}>
                <Text size="xs" mono>
                  {token}
                </Text>
              </span>
            ))}
          </Specimen>
          <Specimen name="space-1 … space-7">
            {SPACES.map((step) => (
              <span
                key={step}
                className="ds-gallery-space"
                data-space={step}
                title={`space-${step}`}
              />
            ))}
          </Specimen>
          <Specimen name="radius-sm · md · lg · xl · full">
            {RADII.map((radius) => (
              <span key={radius} className="ds-gallery-radius" data-radius={radius}>
                <Text size="xs" mono>
                  {radius}
                </Text>
              </span>
            ))}
          </Specimen>
          <Specimen name="Text xs · sm · md · lg · mono">
            <Text size="xs">{sample}</Text>
            <Text>{sample}</Text>
            <Text size="md">{sample}</Text>
            <Text size="lg">{sample}</Text>
            <Text mono>{sample}</Text>
          </Specimen>
          <Specimen name="Text tone">
            {(['default', 'muted', 'faint', 'accent', 'success', 'warning', 'danger'] as const).map(
              (tone) => (
                <Text key={tone} tone={tone}>
                  {tone}
                </Text>
              ),
            )}
          </Specimen>
        </Stack>
      </Section>

      <Section title={t('actions')}>
        <Stack gap={4}>
          <Specimen name="Button primary · quiet · ghost · danger">
            <Button variant="primary" icon={<Plus size={16} />}>
              {t('newThing')}
            </Button>
            <Button variant="quiet" icon={<Upload size={16} />}>
              {t('upload')}
            </Button>
            <Button variant="ghost">{t('cancel')}</Button>
            <Button variant="danger" icon={<Trash2 size={16} />}>
              {t('delete')}
            </Button>
            <Button variant="quiet" size="small">
              {t('small')}
            </Button>
            <Button variant="quiet" disabled>
              {t('disabled')}
            </Button>
          </Specimen>
          <Specimen name="IconButton + Tip">
            <Tip label={t('settings')}>
              <IconButton label={t('settings')}>
                <Settings2 size={16} />
              </IconButton>
            </Tip>
            <IconButton label={t('settings')} pressed>
              <Settings2 size={16} />
            </IconButton>
          </Specimen>
          <Specimen name="ActionMenu (1 → Button, 3 → …)">
            <ActionMenu
              label={t('actions')}
              items={[
                { id: 'one', label: t('upload'), icon: <Upload size={16} />, onSelect: () => {} },
              ]}
            />
            <ActionMenu
              label={t('actions')}
              items={[
                { id: 'a', label: t('upload'), onSelect: () => {} },
                { id: 'b', label: t('settings'), onSelect: () => {} },
                { id: 'c', label: t('delete'), danger: true, onSelect: () => {} },
              ]}
            />
          </Specimen>
          <Specimen name="Dialog">
            <Button variant="quiet" onClick={() => setDialog(true)}>
              {t('openDialog')}
            </Button>
            {dialog && (
              <Dialog title={t('dialogTitle')} onClose={() => setDialog(false)}>
                <Text tone="muted">{sample}</Text>
              </Dialog>
            )}
          </Specimen>
        </Stack>
      </Section>

      <Section title={t('choices')}>
        <Stack gap={4}>
          <Specimen name="Tabs (the one tab pattern)">
            <Tabs<'a' | 'b' | 'c'>
              label={t('choices')}
              value={tab}
              onChange={setTab}
              items={[
                { value: 'a', label: t('tabActive'), count: 3 },
                { value: 'b', label: t('tabPlanned'), count: 1 },
                { value: 'c', label: t('tabAll') },
              ]}
            />
          </Specimen>
          <Specimen name="Segmented (view switch)">
            <Segmented<'tree' | 'circle'>
              label={t('choices')}
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'tree', label: t('tree') },
                { value: 'circle', label: t('circle') },
              ]}
            />
          </Specimen>
          <Specimen name="Badge / Pill tones">
            {(['neutral', 'active', 'accent', 'success', 'warning', 'danger'] as const).map(
              (tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ),
            )}
          </Specimen>
          <Specimen name="PillButton (filter chip)">
            <PillButton icon={<Plus size={14} />}>{t('filter')}</PillButton>
            <PillButton tone="active">{t('tabActive')}</PillButton>
            <Pill>{sample}</Pill>
          </Specimen>
          <Specimen name="StatusDot / StatusPill">
            {(['working', 'waiting', 'error'] as const).map((tone) => (
              <StatusDot key={tone} tone={tone} label={tone} />
            ))}
            {HELENA_STATUSES.slice(0, 5).map((status) => (
              <StatusPill key={status} status={status} />
            ))}
          </Specimen>
        </Stack>
      </Section>

      <Section title={t('fields')}>
        <Grid columns={2} gap={4}>
          <Field label={t('name')} hint={t('hint')}>
            <TextField placeholder={sample} />
          </Field>
          <Field label={t('search')}>
            <SearchField placeholder={t('search')} />
          </Field>
          <Field label={t('description')} error={t('error')}>
            <TextArea rows={3} placeholder={sample} />
          </Field>
        </Grid>
      </Section>

      <Section title={t('surfaces')}>
        {/* Grid min="fit": the cards share the row however many there are. */}
        <Grid min="fit" gap={4}>
          <Card title={t('cardTitle')} meta={t('meta')}>
            <Text tone="muted">{sample}</Text>
          </Card>
          <Card title={t('cardTitle')} interactive>
            <Text tone="muted">{t('interactive')}</Text>
          </Card>
          <Card title={t('cardTitle')} selected>
            <Text tone="muted">{t('selected')}</Text>
          </Card>
        </Grid>
        {/* Notice: a state the reader must not miss, inside a page or a card. */}
        <Stack gap={3}>
          <Notice title={t('cardTitle')}>{t('hint')}</Notice>
          <Notice tone="warning" icon={<CircleAlert />} title={t('cardTitle')}>
            {t('hint')}
          </Notice>
          <Notice tone="danger" icon={<OctagonAlert />} title={t('cardTitle')}>
            {t('hint')}
          </Notice>
        </Stack>
        {/* TimeSeriesChart: one line over time (the equity curve of the trading dashboard). */}
        <Card title={t('cardTitle')}>
          <TimeSeriesChart
            label={t('cardTitle')}
            tone="success"
            points={Array.from({ length: 24 }, (_, i) => ({
              x: Date.UTC(2026, 8, 1 + i),
              y: 1000 + i * 12 + Math.round(Math.sin(i / 2) * 40),
            }))}
            formatX={(x) => new Date(x).toISOString().slice(5, 10)}
            formatY={(y) => String(y)}
          />
        </Card>
      </Section>

      <Section title={t('lists')}>
        <Stack gap={4}>
          <List label={t('lists')}>
            <ListGroup label={t('group')} count={2}>
              <ListRow icon={<FileText size={16} />} title={sample} meta="12:40" />
              <ListRow
                icon={<Bot size={16} />}
                title={t('agent')}
                subtitle={t('meta')}
                dot="working"
                selected
              />
            </ListGroup>
          </List>
          <Table label={t('lists')}>
            <thead>
              <tr>
                <Th>{t('name')}</Th>
                <Th>{t('meta')}</Th>
              </tr>
            </thead>
            <tbody>
              <Tr>
                <Td>{sample}</Td>
                <Td>{t('meta')}</Td>
              </Tr>
            </tbody>
          </Table>
        </Stack>
      </Section>

      <Section title={t('patterns')}>
        <Stack gap={5}>
          <SettingsGroup title={t('settingsGroup')} description={t('hint')}>
            <SettingsRow label={t('name')} description={t('hint')}>
              <TextField defaultValue={sample} />
            </SettingsRow>
            <SettingsRow label={t('danger')} description={t('hint')} danger>
              <Button variant="danger">{t('delete')}</Button>
            </SettingsRow>
          </SettingsGroup>
          <DetailView>
            <DetailHeader
              title={sample}
              status={<StatusPill status="thinking" />}
              meta={t('meta')}
            />
            <DetailGroup title={t('properties')}>
              <PropertyGrid>
                <Property label={t('name')}>{sample}</Property>
                <Property label={t('agent')}>{t('agent')}</Property>
              </PropertyGrid>
            </DetailGroup>
          </DetailView>
          {/* Chat, tasks and goals (hub/ui-3a): the agent chip at the composer, a task's
              status box in the list, a goal's ladder. */}
          <Inline gap={3} wrap>
            <span className="ds-agent-chip">
              <Orb state="idle" size="dot" />
              <span className="ds-agent-chip-label">{t('agentChip')}</span>
            </span>
            <StatusBox icon={<Orb state="thinking" size="dot" motionEnabled={false} />}>
              {t('statusBox')}
            </StatusBox>
          </Inline>
          <ol className="ds-ladder">
            <li className="ds-ladder-step">
              <button type="button">
                <Target size={14} aria-hidden="true" />
                <span>{t('ladderTop')}</span>
              </button>
            </li>
            <li
              className="ds-ladder-step"
              data-current="true"
              style={{ '--ds-ladder-depth': 1 } as CSSProperties}
            >
              <span className="ds-ladder-self">
                <Target size={14} aria-hidden="true" />
                <span>{sample}</span>
              </span>
            </li>
          </ol>
          <Card>
            <EmptyState icon={<Inbox />} action={<Button variant="quiet">{t('newThing')}</Button>}>
              {t('emptySentence')}
            </EmptyState>
          </Card>
        </Stack>
      </Section>
    </Stack>
  );
}

export default function UiGallery() {
  const t = useTranslations('settings.uiGallery');
  return (
    <Grid columns={2} gap={5} data-ui-gallery="">
      {(['light', 'dark'] as const).map((theme) => (
        <div key={theme} data-theme={theme} className="ds-gallery-column">
          <Stack gap={4}>
            <MonoLabel>{theme === 'light' ? t('light') : t('dark')}</MonoLabel>
            <Blocks />
          </Stack>
        </div>
      ))}
    </Grid>
  );
}
