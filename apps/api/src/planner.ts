import { RateLimitedError } from '@repo/auth';
import { projectTemplateRoutes } from './modules/project-templates';
import { controlPlaneWorkflowRoutes } from './modules/control-plane-workflows';
import { routineRoutes } from './modules/routines';
import { connectionsRoutes } from './modules/connections';
import { deviceSyncRoutes } from './modules/device-sync';
import { ownerTerminalRoutes } from './modules/owner-terminal';
import { projectFileRoutes } from './modules/project-files';
import { organizationRoutes } from './modules/organization';
import { Elysia } from 'elysia';
import { HttpError, pgErrorCode } from './shared/lib';
import { authContext } from './shared/auth-context';
import { projectRoutes } from './modules/projects';
import { teamRoutes } from './modules/teams';
import { memberRoutes } from './modules/members';
import { roleRoutes } from './modules/roles';
import { inviteRoutes } from './modules/invites';
import { columnRoutes } from './modules/columns';
import { issueTypeRoutes } from './modules/issue-types';
import { labelRoutes } from './modules/labels';
import { aiAgentRoutes } from './modules/agents/core';
import { integrationRoutes } from './modules/agents/integrations';
import { agentSkillRoutes } from './modules/agents/skills';
import { agentToolRoutes } from './modules/agents/tools';
import { agentMcpServerRoutes } from './modules/agents/mcp-servers';
import { credentialRoutes } from './modules/agents/credentials';
import { connectorRoutes, connectorToolRoutes } from './modules/connectors';
import { agentLearningRoutes } from './modules/agents/learning';
import { customFieldRoutes } from './modules/custom-fields';
import { issueTemplateRoutes } from './modules/issue-templates';
import { issueRoutes } from './modules/issues';
import { initiativeRoutes } from './modules/initiatives';
import { cycleRoutes } from './modules/cycles';
import { attachmentRoutes } from './modules/attachments';
import { chatAttachmentRoutes } from './modules/chat-attachments';
import { importRoutes } from './modules/imports';
import { avatarRoutes } from './modules/avatars';
import { viewRoutes } from './modules/views';
import { shareRoutes } from './modules/share';
import { actionRoutes } from './modules/actions';
import { webhookRoutes } from './modules/webhooks';
import { gitSettingsRoutes } from './modules/git';
import { dashboardRoutes } from './modules/dashboards';
import { noteBoardRoutes } from './modules/note-boards';
import { knowledgeRoutes } from './modules/knowledge';
import { analyticsRoutes } from './modules/analytics';
import { chartRoutes } from './modules/charts';
import { settingsRoutes } from './modules/settings';
import { godRoutes } from './modules/god';
import { pluginAdminRoutes, pluginSlotRoutes } from './modules/plugins';
import { templateBundleRoutes } from './modules/template-bundles';
import { agentRunnerRoutes } from './modules/agents/runner';
import { agentChatRoutes } from './modules/agents/chat';
import { chatPromptRoutes } from './modules/chat-prompts';
import { agentRuntimePolicyRoutes } from './modules/agents/runtime-policy';
import { agentRuntimeSyncRoutes, runnerHealthRoutes } from './modules/agents/runtime-sync';
import { agentRuntimeFileRoutes } from './modules/agents/runtime-files';
import { notificationRoutes } from './modules/notifications';
import { notificationSettingsRoutes } from './modules/notification-settings';
import { notificationPreferenceRoutes } from './modules/notification-preferences';
import { userPreferenceRoutes } from './modules/user-preferences';
import { telegramRoutes } from './modules/telegram';
import { syncRoutes } from './modules/sync';
import { linkPreviewRoutes } from './modules/link-previews';
import { hubInboxRoutes } from './modules/hub-inbox';
import { agentActivityRoutes } from './modules/agent-activity';
import { agentNetworkRoutes } from './modules/agent-egress';
import { agentBrowserGatewayRoutes } from './modules/agent-browser-gateway';
import { approvalRoutes } from './modules/approvals';
import { pipelineRoutes } from './modules/pipelines';
import { mailAccountRoutes } from './modules/mail/accounts';
import { mailDraftRoutes } from './modules/mail/drafts';
import { mailThreadRoutes } from './modules/mail/threads';

// The planner API: projects and their columns, issue types, labels, AI agents,
// custom fields, issues, attachments, saved views, and actions. Mounted on the
// main app in ./index.ts.
//
// Every route requires a better-auth session (the shared authContext plugin each
// feature uses); the only exception is the public raw attachment route. The web
// client sends the session cookie with `credentials: "include"`.
//
// Errors are normalized to a { error } JSON body: HttpError carries its own
// status; a Postgres unique_violation becomes 409; request-body validation
// failures become 400; anything else is a 500 with the error logged.
export const planner = new Elysia({ name: 'planner' })
  .use(authContext)
  .onError({ as: 'global' }, ({ code, error, set }) => {
    // An API key over its request limit: 429 with the seconds to wait.
    if (error instanceof RateLimitedError) {
      set.status = 429;
      set.headers['retry-after'] = String(error.retryAfterSeconds);
      return { error: 'Too many requests', code: 'RATE_LIMITED' };
    }
    if (error instanceof HttpError) {
      set.status = error.status;
      return error.code ? { error: error.message, code: error.code } : { error: error.message };
    }
    if (code === 'VALIDATION') {
      set.status = 400;
      // The validator's first message is enough for the UI; the full report is
      // large JSON that the client would just show verbatim.
      const first = (error as { all?: { summary?: string }[] }).all?.[0]?.summary;
      return { error: first ?? 'Invalid request body' };
    }
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not found' };
    }
    if (pgErrorCode(error) === '23505') {
      set.status = 409;
      return { error: 'A record with this name already exists.' };
    }
    // The message stays in the log only. drizzle puts the failed statement and its
    // parameters in it, and the public routes would hand that to anyone.
    console.error('[planner] unhandled error:', error);
    set.status = 500;
    return { error: 'Internal server error' };
  })
  .use(projectRoutes)
  .use(teamRoutes)
  .use(memberRoutes)
  .use(roleRoutes)
  .use(inviteRoutes)
  .use(columnRoutes)
  .use(issueTypeRoutes)
  .use(labelRoutes)
  .use(aiAgentRoutes)
  .use(integrationRoutes)
  .use(agentSkillRoutes)
  .use(agentToolRoutes)
  .use(agentMcpServerRoutes)
  .use(credentialRoutes)
  .use(connectorRoutes)
  .use(connectorToolRoutes)
  .use(agentLearningRoutes)
  .use(customFieldRoutes)
  .use(issueTemplateRoutes)
  .use(issueRoutes)
  .use(initiativeRoutes)
  .use(cycleRoutes)
  .use(attachmentRoutes)
  .use(chatAttachmentRoutes)
  .use(importRoutes)
  .use(avatarRoutes)
  .use(viewRoutes)
  .use(shareRoutes)
  .use(actionRoutes)
  .use(projectTemplateRoutes)
  .use(controlPlaneWorkflowRoutes)
  .use(webhookRoutes)
  .use(gitSettingsRoutes)
  .use(routineRoutes)
  .use(agentRunnerRoutes)
  .use(agentChatRoutes)
  .use(chatPromptRoutes)
  .use(agentRuntimePolicyRoutes)
  .use(agentRuntimeSyncRoutes)
  .use(runnerHealthRoutes)
  .use(agentRuntimeFileRoutes)
  .use(dashboardRoutes)
  .use(noteBoardRoutes)
  .use(knowledgeRoutes)
  .use(projectFileRoutes)
  .use(analyticsRoutes)
  .use(chartRoutes)
  .use(notificationRoutes)
  .use(notificationSettingsRoutes)
  .use(notificationPreferenceRoutes)
  .use(userPreferenceRoutes)
  .use(telegramRoutes)
  .use(syncRoutes)
  .use(linkPreviewRoutes)
  .use(hubInboxRoutes)
  .use(agentActivityRoutes)
  .use(agentNetworkRoutes)
  .use(agentBrowserGatewayRoutes)
  .use(approvalRoutes)
  .use(pipelineRoutes)
  .use(mailAccountRoutes)
  .use(mailThreadRoutes)
  .use(mailDraftRoutes)
  .use(organizationRoutes)
  .use(connectionsRoutes)
  .use(deviceSyncRoutes)
  .use(ownerTerminalRoutes)
  .use(settingsRoutes)
  .use(godRoutes)
  .use(pluginAdminRoutes)
  .use(pluginSlotRoutes)
  .use(templateBundleRoutes);
