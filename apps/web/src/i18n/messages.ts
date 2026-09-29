import connections from '../../messages/en/connections.json';
import credentials from '../../messages/en/credentials.json';
import access from '../../messages/en/access.json';
import organization from '../../messages/en/organization.json';
import account from '../../messages/en/account.json';
import agentActivity from '../../messages/en/agentActivity.json';
import agentRuntime from '../../messages/en/agentRuntime.json';
import aiChat from '../../messages/en/aiChat.json';
import apiKeys from '../../messages/en/apiKeys.json';
import approvals from '../../messages/en/approvals.json';
import autopilot from '../../messages/en/autopilot.json';
import auth from '../../messages/en/auth.json';
import browserGateway from '../../messages/en/browserGateway.json';
import browserLab from '../../messages/en/browserLab.json';
import chatWorkspace from '../../messages/en/chatWorkspace.json';
import common from '../../messages/en/common.json';
import cycles from '../../messages/en/cycles.json';
import dashboards from '../../messages/en/dashboards.json';
import decisions from '../../messages/en/decisions.json';
import receipts from '../../messages/en/receipts.json';
import devices from '../../messages/en/devices.json';
import knowledge from '../../messages/en/knowledge.json';
import display from '../../messages/en/display.json';
import documents from '../../messages/en/documents.json';
import files from '../../messages/en/files.json';
import filters from '../../messages/en/filters.json';
import god from '../../messages/en/god.json';
import home from '../../messages/en/home.json';
import homeChat from '../../messages/en/homeChat.json';
import inbox from '../../messages/en/inbox.json';
import initiatives from '../../messages/en/initiatives.json';
import invite from '../../messages/en/invite.json';
import issue from '../../messages/en/issue.json';
import issueLinks from '../../messages/en/issueLinks.json';
import mail from '../../messages/en/mail.json';
import mcp from '../../messages/en/mcp.json';
import members from '../../messages/en/members.json';
import meta from '../../messages/en/meta.json';
import nav from '../../messages/en/nav.json';
import newProject from '../../messages/en/newProject.json';
import notes from '../../messages/en/notes.json';
import ownerTerminal from '../../messages/en/ownerTerminal.json';
import serverSecurity from '../../messages/en/serverSecurity.json';
import palette from '../../messages/en/palette.json';
import permissions from '../../messages/en/permissions.json';
import pipelines from '../../messages/en/pipelines.json';
import projects from '../../messages/en/projects.json';
import providerLimits from '../../messages/en/providerLimits.json';
import modelAvailability from '../../messages/en/modelAvailability.json';
import localAi from '../../messages/en/localAi.json';
import routines from '../../messages/en/routines.json';
import sections from '../../messages/en/sections.json';
import server from '../../messages/en/server.json';
import settings from '../../messages/en/settings.json';
import shell from '../../messages/en/shell.json';
import teams from '../../messages/en/teams.json';
import updates from '../../messages/en/updates.json';
import views from '../../messages/en/views.json';
import workItems from '../../messages/en/workItems.json';
import { DEFAULT_LOCALE, type Locale } from './locales';

// English is static: it is the fallback for every other language and the shape the
// `t('…')` keys are typed against.
const defaultMessages = {
  meta,
  auth,
  common,
  nav,
  home,
  homeChat,
  palette,
  views,
  shell,
  sections,
  issueLinks,
  issue,
  display,
  documents,
  files,
  filters,
  workItems,
  apiKeys,
  invite,
  mcp,
  mail,
  projects,
  aiChat,
  chatWorkspace,
  inbox,
  approvals,
  autopilot,
  permissions,
  members,
  cycles,
  dashboards,
  decisions,
  receipts,
  initiatives,
  notes,
  ownerTerminal,
  serverSecurity,
  account,
  settings,
  god,
  newProject,
  teams,
  updates,
  organization,
  connections,
  credentials,
  access,
  agentActivity,
  agentRuntime,
  browserGateway,
  browserLab,
  routines,
  pipelines,
  devices,
  providerLimits,
  modelAvailability,
  localAi,
  knowledge,
  server,
};

export type Messages = typeof defaultMessages;

const NAMESPACES = Object.keys(defaultMessages) as (keyof Messages)[];

export async function loadMessages(locale: Locale, appName = 'Ava'): Promise<Messages> {
  const messages = await loadRawMessages(locale);
  return replaceAppName(messages, appName) as Messages;
}

async function loadRawMessages(locale: Locale): Promise<Messages> {
  if (locale === DEFAULT_LOCALE) return defaultMessages;

  const translated = await Promise.all(
    NAMESPACES.map(async (ns) => [
      ns,
      (await import(`../../messages/${locale}/${ns}.json`)).default,
    ]),
  );

  // A key still untranslated renders its English text instead of the raw key path.
  return mergeMessages(defaultMessages, Object.fromEntries(translated)) as Messages;
}

function replaceAppName(tree: MessageTree, appName: string): MessageTree {
  return Object.fromEntries(
    Object.entries(tree).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? value
            .replaceAll('{appNameUpper}', appName.toLocaleUpperCase())
            .replaceAll('{appName}', appName)
        : replaceAppName(value, appName),
    ]),
  );
}

type MessageTree = { [key: string]: string | MessageTree };

function mergeMessages(base: MessageTree, override: MessageTree): MessageTree {
  const result: MessageTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      typeof value === 'object' && typeof current === 'object'
        ? mergeMessages(current, value)
        : value;
  }
  return result;
}
