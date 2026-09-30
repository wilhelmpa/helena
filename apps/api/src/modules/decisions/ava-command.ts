import type { DecisionQuestion } from '@helena/sdk';
import { getMcpApp } from '#mcp/app-ref';
import { dispatchTool } from '#mcp/dispatch';
import { routeTools } from '#mcp/generate';
import type { McpCredential } from '#mcp/credential';
import { decide, type DecideRequest } from './service';
import { AVA_COMMAND_CLASS, AVA_QUESTIONS, avaChoice, parseAvaCommand } from './ava-questions';
import { optimizationEnabled } from './optimization-policy';

interface Hit {
  ref: string;
  title: string;
  cite: string;
  path: string | null;
  projectKey: string | null;
  read?: { name: string; args: Record<string, unknown> };
}
type Scope = Pick<DecideRequest, 'teamId' | 'agentId' | 'projectId' | 'chatMessageId'> & {
  projectKey: string | null;
};
const sources: Record<string, string> = {
  aufgabe: 'issue',
  aufgaben: 'issue',
  wissen: 'vault',
  beleg: 'receipt',
  belege: 'receipt',
  mail: 'mail',
  mails: 'mail',
  projekt: 'project',
  projekte: 'project',
  agent: 'agent',
  agenten: 'agent',
};

export function avaCommandForRequest(request: Request, scope: Omit<Scope, 'chatMessageId'>) {
  const apiKey = request.headers.get('x-api-key');
  const cookie = request.headers.get('cookie');
  let credential: McpCredential | { kind: 'session'; cookie: string } | null = null;
  if (apiKey) credential = { kind: 'api-key', apiKey };
  else if (cookie) credential = { kind: 'session', cookie };
  if (!credential) return undefined;
  return async (
    prompt: string,
    messageId: number,
    beforeExecute: () => Promise<boolean>,
  ): Promise<string | null> => {
    const app = getMcpApp();
    const catalog = new Map(routeTools(app).map((tool) => [tool.name, tool]));
    const invoke = async (name: string, args: Record<string, unknown>) => {
      const tool = catalog.get(name);
      if (!tool || ['delete', 'send', 'pay', 'execute', 'credentials'].includes(tool.category))
        throw new Error('Unsupported command tool.');
      const result = await dispatchTool(app, tool, args, credential, { viaMcpEndpoint: false });
      if (result.isError) throw new Error('Command tool refused the request.');
      return JSON.parse(result.text) as unknown;
    };
    let attempted = false;
    const ask = async (
      context: Record<string, unknown>,
      questions: Record<string, DecisionQuestion>,
    ) => {
      const result = await decide({
        ...scope,
        chatMessageId: messageId,
        classId: AVA_COMMAND_CLASS,
        context,
        questions,
        subject: 'ava-command',
        localOnly: true,
        allowPrivateJev: true,
      });
      if (result.status !== 'decided' || !['typesafe', 'vercel'].includes(result.backend ?? ''))
        return null;
      return result.answers;
    };
    const pick = async (wanted: string, options: { id: string; label: string }[]) => {
      if (!options.length || options.length > 20) return null;
      const exact = options.filter(
        (option) =>
          option.label.trim().toLocaleLowerCase('de') === wanted.trim().toLocaleLowerCase('de'),
      );
      if (exact.length !== 1) return null;
      const answer = await ask(
        { wanted },
        { selected: avaChoice('Select the explicitly requested object or parameter.', options) },
      );
      const choice = answer?.selected?.decided ? answer.selected.choice : null;
      return exact[0]?.id === choice ? choice : null;
    };
    try {
      const command = parseAvaCommand(prompt);
      if (!command || !(await optimizationEnabled(scope, AVA_COMMAND_CLASS))) return null;
      const first = await ask({ prompt }, AVA_QUESTIONS);
      if (first?.simple?.choice !== 'command' || first.action?.choice !== command.action)
        return null;
      const search = async (query: string, source: string) => {
        if (source === 'project' || source === 'agent') {
          const entries = (await invoke(
            source === 'project' ? 'list_projects' : 'list_ai_agents',
            source === 'project'
              ? {}
              : {
                  teamId: scope.teamId,
                  ...(scope.projectId ? { projectId: scope.projectId } : {}),
                },
          )) as { id: number; key?: string; name: string; username?: string; teamId?: number }[];
          return entries
            .filter(
              (entry) =>
                (entry.teamId === undefined || entry.teamId === scope.teamId) &&
                [entry.name, entry.key, entry.username].some((value) =>
                  value?.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')),
                ),
            )
            .slice(0, 20)
            .map((entry): Hit => ({
              ref: `${source}:${entry.id}`,
              title: entry.name,
              cite:
                source === 'project' && entry.key
                  ? `[${entry.name.replace(/[[\]]/g, '')}](/project/${encodeURIComponent(entry.key)})`
                  : entry.name.replace(/[[\]]/g, ''),
              path: null,
              projectKey: entry.key ?? null,
              read:
                source === 'project'
                  ? { name: 'get_project', args: { projectKey: entry.key } }
                  : { name: 'get_ai_agent', args: { teamId: scope.teamId, agentId: entry.id } },
            }));
        }
        const result = (await invoke('search_knowledge', {
          q: query,
          sources: source,
          limit: 20,
          ...(scope.projectKey ? { project: scope.projectKey } : {}),
        })) as { items?: Hit[] };
        return result.items ?? [];
      };
      const source = sources[command.domain];
      if (!source) return null;
      let tool = '';
      let args: Record<string, unknown> = {};
      let confirmation = '';
      if (command.action === 'search') {
        const hits = await search(command.query, source);
        confirmation = hits.length
          ? `Ich habe passende Einträge gefunden.\n${hits
              .slice(0, 6)
              .map((hit) => hit.cite)
              .join('\n')}`
          : 'Ich habe keine passenden Einträge gefunden.';
      } else {
        let hit: Hit | undefined;
        if (command.action !== 'create') {
          const hits = await search(command.query, source);
          const selected = await pick(
            command.query,
            hits.map((entry, i) => ({ id: `c${i}`, label: entry.title })),
          );
          if (!selected) return null;
          hit = hits[Number(selected.slice(1))];
          if (!hit) return null;
        }
        if (command.action === 'open') {
          tool = hit!.read?.name ?? 'read_knowledge';
          args = hit!.read?.args ?? { ref: hit!.ref, maxChars: 1000 };
          confirmation = `Hier ist der Eintrag.\n${hit!.cite}`;
        } else {
          if (
            !scope.projectKey ||
            (hit && (hit.projectKey !== scope.projectKey || !/^issue:\d+$/.test(hit.ref)))
          )
            return null;
          if (hit) args.issueId = Number(hit.ref.slice(6));
          if (command.action === 'comment') {
            // Mentions send notifications and need the normal agent's handling.
            if (command.value?.includes('@')) return null;
            tool = 'add_comment';
            args.body = command.value;
            confirmation = 'Der Kommentar ist hinzugefügt.';
          } else if (command.action === 'due') {
            if (
              !command.value ||
              new Date(command.value).toISOString().slice(0, 10) !== command.value
            )
              return null;
            tool = 'update_issue';
            args.dueDate = command.value;
            confirmation = 'Die Fälligkeit ist eingetragen.';
          } else if (command.action === 'attach') {
            const files = await search(command.value!, 'vault');
            const selected = await pick(
              command.value!,
              files.map((file, i) => ({ id: `f${i}`, label: file.title })),
            );
            const file = selected ? files[Number(selected.slice(1))] : null;
            const prefix = `Projects/${scope.projectKey}/`;
            if (!file?.path?.startsWith(prefix)) return null;
            tool = 'link_attachment';
            args.path = file.path.slice(prefix.length);
            confirmation = 'Die Datei ist angehängt.';
          } else {
            const board = (await invoke('get_project', { projectKey: scope.projectKey })) as {
              columns: { id: number; name: string }[];
              assignees: { userId: string; name: string; kind: string }[];
            };
            const options =
              command.action === 'assign'
                ? board.assignees
                    .filter((person) => person.kind === 'member')
                    .map((person) => ({ id: person.userId, label: person.name }))
                : board.columns.map((column) => ({ id: String(column.id), label: column.name }));
            const parameter = await pick(command.value!, options);
            if (!parameter) return null;
            if (command.action === 'assign') {
              tool = 'update_issue';
              args.assigneeUserId = parameter;
              confirmation = 'Die Aufgabe ist zugewiesen.';
            } else if (command.action === 'status') {
              tool = 'update_issue';
              args.columnId = Number(parameter);
              confirmation = 'Der Status ist geändert.';
            } else if (command.action === 'create') {
              tool = 'create_issue';
              args = {
                projectKey: scope.projectKey,
                title: command.query,
                columnId: Number(parameter),
              };
              confirmation = 'Die Aufgabe ist angelegt.';
            } else return null;
          }
        }
      }
      const phrase = await ask(
        { action: command.action },
        {
          confirmation: avaChoice(
            'Select the matching confirmation to speak only after successful execution.',
            [{ id: 'done', label: confirmation.split('\n')[0]! }],
          ),
        },
      );
      if (phrase?.confirmation?.choice !== 'done' || !(await beforeExecute())) return null;
      if (tool) {
        attempted = true;
        await invoke(tool, args);
      }
      return confirmation;
    } catch {
      return attempted
        ? 'Die Ausführung konnte nicht bestätigt werden. Bitte prüfe den Eintrag, bevor du den Befehl wiederholst.'
        : null;
    }
  };
}
