import { t } from 'elysia';
import { HotkeyCombosSchema } from '#modules/settings/model';

// The interface languages (@helena/locales LOCALES).
export const LocaleSchema = t.Union([
  t.Literal('en'),
  t.Literal('uk'),
  t.Literal('ru'),
  t.Literal('zh-CN'),
  t.Literal('ar'),
  t.Literal('fr'),
  t.Literal('pt-BR'),
  t.Literal('id'),
  t.Literal('es-ES'),
  t.Literal('de'),
]);
const Theme = t.Union([t.Literal('light'), t.Literal('dark'), t.Literal('system')]);
const IssueOpenMode = t.Union([t.Literal('panel'), t.Literal('page')]);
const HeaderLayout = t.Union([t.Literal('single'), t.Literal('classic')]);
const StartPage = t.Union([
  t.Literal('inbox'),
  t.Literal('dashboard'),
  t.Literal('work-items'),
  t.Literal('initiatives'),
]);
const IssueStatsView = t.Union([t.Literal('compact'), t.Literal('timeline')]);
const IssueActivityView = t.Union([t.Literal('flat'), t.Literal('grouped')]);

// Start as the user arranged it: widget ids (and, in `dismissed`, the keys of hidden
// failures of "Braucht dich"). Ids only, bounded, so the row stays small.
const WidgetId = t.String({ minLength: 1, maxLength: 160 });
export const HomeDashboardSchema = t.Object({
  order: t.Array(WidgetId, { maxItems: 100 }),
  hidden: t.Array(WidgetId, { maxItems: 100 }),
  shown: t.Array(WidgetId, { maxItems: 100 }),
  dismissed: t.Array(WidgetId, { maxItems: 200 }),
  chatAnimation: t.Optional(t.Boolean()),
});

export const PreferenceResponse = t.Object({
  timezone: t.String(),
  locale: LocaleSchema,
  theme: Theme,
  issueOpenMode: IssueOpenMode,
  headerLayout: HeaderLayout,
  startPage: StartPage,
  showChatByDefault: t.Boolean(),
  issueStatsOpen: t.Boolean(),
  issueStatsView: IssueStatsView,
  issueActivityView: IssueActivityView,
  autoWatch: t.Boolean(),
  lastProjectId: t.Nullable(t.Number()),
  hotkeys: HotkeyCombosSchema,
  homeDashboard: HomeDashboardSchema,
});

export const PreferencePatch = t.Object({
  timezone: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
  locale: t.Optional(LocaleSchema),
  theme: t.Optional(Theme),
  issueOpenMode: t.Optional(IssueOpenMode),
  headerLayout: t.Optional(HeaderLayout),
  startPage: t.Optional(StartPage),
  showChatByDefault: t.Optional(t.Boolean()),
  issueStatsOpen: t.Optional(t.Boolean()),
  issueStatsView: t.Optional(IssueStatsView),
  issueActivityView: t.Optional(IssueActivityView),
  autoWatch: t.Optional(t.Boolean()),
  lastProjectId: t.Optional(t.Nullable(t.Number())),
  hotkeys: t.Optional(HotkeyCombosSchema),
  homeDashboard: t.Optional(HomeDashboardSchema),
});

export const ActiveChatQuery = t.Object({ scope: t.String({ minLength: 4, maxLength: 120 }) });
export const ActiveChatLocationSchema = t.Object({
  agentId: t.Nullable(t.Number()),
  threadId: t.Nullable(t.String()),
});
