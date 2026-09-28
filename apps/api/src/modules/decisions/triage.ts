import { AGENT_ROUTING_CLASS, TASK_TRIAGE_CLASS } from './classes';
import { decide } from './service';
import {
  agentRoutingQuestions,
  taskTriageQuestions,
  type TriageCandidate,
} from './triage-questions';
import { cascadeAnswer } from './triage-cascade';

export async function triageTask(input: {
  teamId: number;
  projectId: number;
  title: string;
  description?: string;
  candidates: TriageCandidate[];
  subject?: string;
}) {
  const candidates = input.candidates.slice(0, 14);
  const outcome = await decide({
    teamId: input.teamId,
    projectId: input.projectId,
    classId: TASK_TRIAGE_CLASS,
    subject: input.subject,
    context: {
      title: input.title.slice(0, 300),
      description: input.description?.slice(0, 2000) ?? '',
      candidates,
    },
    questions: taskTriageQuestions(candidates),
  });
  return {
    owner: cascadeAnswer(
      outcome.answers.owner,
      candidates.map((candidate) => candidate.id),
    ),
    priority: cascadeAnswer(outcome.answers.priority, ['urgent', 'high', 'medium', 'low']),
    status: outcome.status,
  };
}

export async function routeTaskAgent(input: {
  teamId: number;
  projectId: number;
  title: string;
  description?: string;
  candidates: TriageCandidate[];
  subject?: string;
}) {
  const candidates = input.candidates.slice(0, 14);
  const outcome = await decide({
    teamId: input.teamId,
    projectId: input.projectId,
    classId: AGENT_ROUTING_CLASS,
    subject: input.subject,
    context: {
      title: input.title.slice(0, 300),
      description: input.description?.slice(0, 2000) ?? '',
      candidates,
    },
    questions: agentRoutingQuestions(candidates),
  });
  return {
    agent: cascadeAnswer(
      outcome.answers.agent,
      candidates.map((candidate) => candidate.id),
    ),
    status: outcome.status,
  };
}
