import { decide, type DecideRequest } from './service';
import { TOOL_SELECTION_CLASS, toolSelectionQuestions } from './tool-selection-questions';
import { optimizationEnabled } from './optimization-policy';

export async function selectTools(
  scope: Pick<DecideRequest, 'teamId' | 'projectId' | 'agentId' | 'runId' | 'chatMessageId'>,
  prompt: string,
  tools: { name: string; description: string }[],
) {
  if (!(await optimizationEnabled(scope, TOOL_SELECTION_CLASS))) return { names: null };
  const unique = [...new Map(tools.map((tool) => [tool.name, tool])).values()];
  if (!unique.length) return { names: null };
  const result = await decide({
    ...scope,
    classId: TOOL_SELECTION_CLASS,
    context: { task: prompt },
    questions: toolSelectionQuestions(unique),
    subject: 'tool-selection',
    localOnly: true,
    allowPrivateJev: true,
  });
  if (result.status !== 'decided' || !['typesafe', 'vercel'].includes(result.backend ?? ''))
    return { names: null };
  const selected: string[] = [];
  for (const [index, tool] of unique.entries()) {
    const answer = result.answers[`t${index}`];
    if (!answer?.decided || !['use', 'skip'].includes(answer.choice ?? '')) return { names: null };
    if (answer.choice === 'use') selected.push(tool.name);
  }
  return { names: selected.length ? selected.slice(0, 8) : null };
}
