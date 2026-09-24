'use client';

import { Fragment, type ReactNode } from 'react';
import type { DynamicToolUIPart } from 'ai';
import { LoaderCircle, TriangleAlert, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Task, TaskContent, TaskTrigger } from '@/components/ai-elements/task';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  isToolRunning,
} from '@/components/ai-elements/tool';

// A tool the caller shows in its own way (the chat's approval card for
// `request_approval`), or undefined for the standard row.
export type RenderTool = (tool: DynamicToolUIPart) => ReactNode | undefined;

// One tool call: its name and state, opening onto what it was given and what it answered.
export function AgentToolCall({ tool }: { tool: DynamicToolUIPart }) {
  const t = useTranslations('common.agentChat');
  const stateLabel =
    tool.state === 'output-error' || tool.state === 'output-denied'
      ? t('toolFailed')
      : tool.state === 'output-available'
        ? t('toolDone')
        : t('toolRunning');
  return (
    <Tool>
      <ToolHeader name={tool.toolName} state={tool.state} stateLabel={stateLabel} />
      <ToolContent>
        <ToolInput input={tool.input} label={t('toolInput')} />
        <ToolOutput
          output={tool.state === 'output-available' ? tool.output : undefined}
          errorText={tool.state === 'output-error' ? tool.errorText : undefined}
          label={t('toolOutput')}
        />
      </ToolContent>
    </Tool>
  );
}

// The tool calls an answer made between two stretches of text, folded into one line —
// "3 tool calls", the one running now named beside it, a warning when one failed — that
// opens onto each call. The reader sees at a glance how much ran without the transcript
// filling up with it.
export function AgentToolGroup({
  tools,
  renderTool,
}: {
  tools: DynamicToolUIPart[];
  renderTool?: RenderTool;
}) {
  const t = useTranslations('common.agentChat');
  const own: ReactNode[] = [];
  const rest: DynamicToolUIPart[] = [];
  for (const tool of tools) {
    const custom = renderTool?.(tool);
    if (custom === undefined) rest.push(tool);
    else own.push(<Fragment key={tool.toolCallId}>{custom}</Fragment>);
  }
  const running = rest.find((tool) => isToolRunning(tool.state));
  const failed = rest.some((tool) => tool.state === 'output-error');

  return (
    <div className="space-y-2">
      {own}
      {rest.length > 0 && (
        <Task>
          <TaskTrigger>
            {running ? (
              <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
            ) : failed ? (
              <TriangleAlert className="size-3.5 shrink-0 text-status-danger" />
            ) : (
              <Wrench className="size-3.5 shrink-0" />
            )}
            <span>{t('toolCalls', { count: rest.length })}</span>
            {running && (
              <span dir="ltr" className="truncate font-mono text-xs">
                {running.toolName}
              </span>
            )}
          </TaskTrigger>
          <TaskContent>
            {rest.map((tool) => (
              <AgentToolCall key={tool.toolCallId} tool={tool} />
            ))}
          </TaskContent>
        </Task>
      )}
    </div>
  );
}
