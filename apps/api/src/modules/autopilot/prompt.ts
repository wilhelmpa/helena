import type { ActionCategory, AutopilotLevel } from '@helena/policy';
import { levelName, levelRules, type LevelRule } from './engine';

// What an agent is told about its Autopilot level, built from the engine's own rules so the
// words and the enforcement cannot drift apart.

const WHAT: Record<ActionCategory, string> = {
  read: 'read',
  report: 'comment, ask and report on your task',
  write: 'change {appName} and files in your workspace',
  send: 'send or submit anything outside {appName}',
  delete: 'delete',
  pay: 'pay',
  publish: 'publish, push or deploy',
  execute: 'run risky commands or code',
  credentials: 'change logins, keys or grants',
};

function phrase(rule: LevelRule, displayName: string): string {
  const base = WHAT[rule.category].replaceAll('{appName}', displayName);
  if (rule.scope === 'workspace') return `${base} inside your workspace`;
  if (rule.scope === 'external') return `${base} outside your workspace`;
  return base;
}

export function levelInWords(
  level: AutopilotLevel,
  displayName = 'Ava',
): { free: string; approval: string } {
  const rules = levelRules(level);
  const join = (items: string[]) => (items.length > 0 ? items.join(', ') : 'nothing');
  return {
    free: join(rules.filter((r) => r.outcome === 'allow').map((rule) => phrase(rule, displayName))),
    approval: join(
      rules.filter((r) => r.outcome !== 'allow').map((rule) => phrase(rule, displayName)),
    ),
  };
}

// The Autopilot section of a run's system prompt.
export function autopilotRunSection(
  projectKey: string,
  level: AutopilotLevel,
  displayName = 'Ava',
): string {
  const { free, approval } = levelInWords(level, displayName);
  return [
    '## Autopilot',
    `Your Autopilot level in project ${projectKey} is ${levelName(level)}.`,
    `Without asking you may: ${free}.`,
    `A person approves first: ${approval}. For those, call request_approval with the action, ` +
      'its kind and every detail a person needs, then end the run without taking the action.',
    ...(level >= 2
      ? [
          `${displayName} posts a report of what you did without approval on the task after the run.`,
        ]
      : []),
    `${displayName} checks every tool call against this; a blocked call tells you what to do.`,
    '',
  ].join('\n');
}

// The Autopilot section of an agent's SOUL.md: its level in each of its projects, for chats,
// which carry no run frame.
export function autopilotSoulSection(
  projects: { key: string; level: AutopilotLevel }[],
  displayName = 'Ava',
): string {
  const lines = [
    '## Approvals and Autopilot',
    `${displayName} decides on every tool call how independently you may act, by the Autopilot level`,
    'of the project you work in. A blocked call says why. When it needs a person,',
    'call request_approval with the action, its kind and every detail the person needs to',
    `decide, then end the run (in a chat: tell the person) without taking the action. ${displayName}`,
    'starts a new run of yours with the decision: act only on an approved request, exactly as',
    'approved. get_approval reads a request.',
  ];
  for (const project of projects) {
    const { free, approval } = levelInWords(project.level, displayName);
    lines.push(
      '',
      `In project ${project.key}: level ${levelName(project.level)}. Free: ${free}. ` +
        `Approval first: ${approval}.`,
    );
  }
  return lines.join('\n');
}
