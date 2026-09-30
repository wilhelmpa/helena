// Helena UI framework (docs/ui-framework.md, docs/design-system.md): the ONE public API
// for pages, features and plugins. Tokens (tokens.css: colours light/dark, spacing,
// radii, type), layout (Page template, toolbar, panel, overlay, modal), building blocks
// (Card, List, Table, Pill/Badge, Tabs, Button, Field, EmptyState, Dialog, Menu) and
// patterns (SettingsGroup/Row, DetailView; the FilterBar of project data lives in
// components/layout because it reads the project). Pages and features import only
// from here; eslint rejects free colours, spacing, radii and type sizes in them.
export {
  Tree,
  TreeItem,
  TreeGap,
  TreeAction,
  TreeNote,
  TreeSearch,
  TreeScroll,
  useTreeLevel,
} from './components/Tree';
export type { TreeItemProps } from './components/Tree';
export { StatusDot } from './components/StatusDot';
export { StatusBox } from './components/StatusBox';
export { ToolbarPopover } from './components/ToolbarPopover';
// The searchable pick list of a field (status, priority, goal …) in a popover: one
// implementation, with groups, a trailing note per row and "create what I typed".
export { default as PopoverPick } from '@/components/common/fields/PopoverPick';
export type { PickItem, PickGroup, PickCreate } from '@/components/common/fields/PopoverPick';
export type { StatusDotTone } from './components/StatusDot';
export { Button, ButtonAnchor, ButtonLink, IconButton } from './components/Button';
export type { ButtonVariant } from './components/Button';
export { Pill, PillButton, Pill as Badge } from './components/Pill';
export { Segmented } from './components/Segmented';
export { SegmentToggle } from './components/SegmentToggle';
export { InheritedMark } from './components/InheritedMark';
export type { SegmentOption } from './components/Segmented';
export type { PillTone } from './components/Pill';
export { TextField, TextArea, Field, SearchField } from './components/Field';
export { Switch } from '@/components/ui/switch';
export { Card } from './components/Card';
export { Notice } from './components/Notice';
export type { NoticeTone } from './components/Notice';
export { TimeSeriesChart } from './components/TimeSeriesChart';
export type { TimeSeriesPoint, TimeSeriesTone } from './components/TimeSeriesChart';
export { Section, MonoLabel, EmptyState } from './components/Section';
export { EmbedProblem } from './components/EmbedProblem';
export { EmbedConnecting } from './components/EmbedConnecting';
export { Box, Stack, Inline, Grid, Text } from './components/Layout';
export type { Space, TextSize, TextTone } from './components/Layout';
export { ActionMenu, Tip } from './components/ActionMenu';
export { NameList } from './components/NameList';
export type { ActionMenuItem } from './components/ActionMenu';
export { List, ListGroup, ListRow } from './components/List';
export { Table, Th, Tr, Td } from './components/Table';
export { MatrixCell, MatrixCellButton, MatrixNote, MatrixBar } from './components/Matrix';
export type { MatrixMark } from './components/Matrix';
export { Checkbox } from '@/components/ui/checkbox';
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
export { LocalChrome } from './layout/LocalChrome';
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
export type { Crumb } from './layout/Page';
export { SidePanel } from './layout/SidePanel';
export { Overlay } from './layout/Overlay';
export { OverlayControls } from './components/OverlayControls';
export type { OverlayControlsLabels } from './components/OverlayControls';
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
// The status pieces (ui-system.md §2), one implementation each. The chat's Composer and
// AgentPicker read the API and stay in components/helena, outside the framework.
export { default as Orb } from '@/components/helena/Orb';
export { default as StatusPill } from '@/components/helena/StatusPill';
export { ProjectTag } from '@/components/helena/ProjectTag';
export { Tile } from '@/components/helena/DashboardPrimitives';
export { default as RuntimePicker } from '@/components/helena/RuntimePicker';
