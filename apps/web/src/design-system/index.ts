// Helena UI framework (docs/ui-framework.md, docs/design-system.md): the ONE public API
// for pages, features and plugins. Tokens (tokens.css: colours light/dark, spacing,
// radii, type), layout (Page template, toolbar, panel, overlay, modal), building blocks
// (Card, List, Table, Pill/Badge, Tabs, Button, Field, EmptyState, Dialog, Menu) and
// patterns (SettingsGroup/Row, FilterBar, DetailView). Pages and features import only
// from here; eslint rejects free colours, spacing, radii and type sizes in them.
export { Tree, TreeItem, TreeGap, TreeAction, useTreeLevel } from './components/Tree';
export type { TreeItemProps } from './components/Tree';
export { StatusDot } from './components/StatusDot';
export type { StatusDotTone } from './components/StatusDot';
export { Button, ButtonLink, IconButton } from './components/Button';
export type { ButtonVariant } from './components/Button';
export { Pill, PillButton, Pill as Badge } from './components/Pill';
export { Segmented } from './components/Segmented';
export type { SegmentOption } from './components/Segmented';
export type { PillTone } from './components/Pill';
export { TextField, TextArea, Field, SearchField } from './components/Field';
export { Card } from './components/Card';
export { Section, MonoLabel, EmptyState } from './components/Section';
export { Box, Stack, Inline, Grid, Text } from './components/Layout';
export type { Space, TextSize, TextTone } from './components/Layout';
export { ActionMenu, Tip } from './components/ActionMenu';
export type { ActionMenuItem } from './components/ActionMenu';
export { List, ListGroup, ListRow } from './components/List';
export { Table, Th, Tr, Td } from './components/Table';
export {
  DetailView,
  DetailHeader,
  DetailGroup,
  PropertyGrid,
  Property,
  More,
} from './components/DetailView';
export { SettingsGroup, SettingsRow } from './components/SettingsGroup';
export * from './components/Menu';
export { PageHeader, PageToolbarRow, PageBody } from './layout/Page';
export { Page } from './layout/PageTemplate';
export type { PageVariant } from './layout/PageTemplate';
export {
  PageToolbar,
  PageToolbarSpacer,
  PageTabs,
  PageTabs as Tabs,
  PageSearch,
  PageSelect,
  PageActions,
  usePageToolbarRoom,
  PAGE_CONTROL_CLASS,
  PAGE_PRIMARY_CLASS,
} from './layout/PageToolbar';
export type { PageTab, PageAction, PageSelectOption } from './layout/PageToolbar';
export { default as Dialog, useModalFullscreen } from '@/components/common/overlay/Modal';
export { default as FilterBar } from '@/components/layout/FilterBar';
export type { Crumb } from './layout/Page';
export { SidePanel } from './layout/SidePanel';
export { Overlay } from './layout/Overlay';
export type { OverlayTab } from './layout/Overlay';
export {
  useSidePanelWidth,
  SidePanelResizeHandle,
  clampSidePanelWidth,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_MAX_RATIO,
  SIDE_PANEL_DEFAULT_WIDTH,
} from './layout/sidePanelWidth';
export { Modal, ModalNavItem, ModalNavGroup } from './layout/Modal';
export { PageChromeCtx, usePageChrome } from './layout/pageChrome';
export type { PageChrome } from './layout/pageChrome';
export type { ModalTab } from './layout/Modal';
export { pickActive, matchScore } from './nav/activeMatch';
export type { NavCandidate, NavLocation } from './nav/activeMatch';
// The status and agent pieces (ui-system.md §2), one implementation each.
export { default as Orb } from '@/components/helena/Orb';
export { default as StatusPill } from '@/components/helena/StatusPill';
export { ProjectTag } from '@/components/helena/ProjectTag';
export { Tile } from '@/components/helena/DashboardPrimitives';
export { default as RuntimePicker } from '@/components/helena/RuntimePicker';
export { default as AgentPicker } from '@/components/helena/AgentPicker';
export { default as Composer } from '@/components/helena/Composer';
