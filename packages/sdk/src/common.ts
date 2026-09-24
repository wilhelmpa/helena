// The small shapes every extension point shares.

// An agent as an extension sees it. `userId` is the agent's member id: agents are members
// of their team, so the id a task is assigned to.
export interface AgentRef {
  id: number;
  userId?: string;
  name?: string;
  // The agent template this agent is a copy of.
  templateId?: number | null;
}

export interface ProjectRef {
  id: number;
  key?: string;
  teamId?: number;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// A logger that prefixes every line with the plugin or component it belongs to.
export function consoleLogger(prefix: string): Logger {
  const line = (message: string, data?: Record<string, unknown>) =>
    data ? `[${prefix}] ${message} ${JSON.stringify(data)}` : `[${prefix}] ${message}`;
  return {
    info: (message, data) => console.log(line(message, data)),
    warn: (message, data) => console.warn(line(message, data)),
    error: (message, data) => console.error(line(message, data)),
  };
}
