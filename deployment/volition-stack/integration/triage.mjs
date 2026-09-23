import crypto from "node:crypto";
import { readJson, writeJsonAtomic } from "./atomic-json.mjs";
import { InboxValidationError } from "./inbox.mjs";
import { createMastraInboxRunner } from "./mastra-inbox.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const ISSUE_IDENTIFIER = /\b[A-Z][A-Z0-9_-]{0,15}-\d+\b/g;
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

function boundedString(value, maximum, required = false) {
  if (typeof value !== "string" || value.length > maximum || (required && value.length === 0)) {
    throw new InboxValidationError("The inbox triage body is invalid");
  }
  return value;
}

function timestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new InboxValidationError("The inbox triage body is invalid");
  return date.toISOString();
}

function message(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InboxValidationError("The inbox triage body is invalid");
  }
  return {
    sender: boundedString(value.sender, 500),
    subject: boundedString(value.subject, 500),
    snippet: boundedString(value.snippet, 2000),
    receivedAt: timestamp(boundedString(value.receivedAt, 64, true)),
  };
}

export function validateTriageRequest(value, allowedAccounts) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) {
    throw new InboxValidationError("The inbox triage body is invalid");
  }
  const source = value.thread;
  if (!source || typeof source !== "object" || Array.isArray(source) || !UUID.test(source.id)) {
    throw new InboxValidationError("The inbox triage thread is invalid");
  }
  const account = boundedString(source.account, 320, true).toLowerCase();
  if (!allowedAccounts.includes(account) || source.channel !== "mail") {
    throw new InboxValidationError("The inbox triage source is invalid");
  }
  if (!Array.isArray(source.messages) || source.messages.length > 5) {
    throw new InboxValidationError("The inbox triage messages are invalid");
  }
  if (!Array.isArray(value.projects) || value.projects.length > 100) {
    throw new InboxValidationError("The inbox triage projects are invalid");
  }
  const projects = value.projects.map((project) => {
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new InboxValidationError("The inbox triage projects are invalid");
    }
    const key = boundedString(project.key, 32, true).toUpperCase();
    if (!PROJECT_KEY.test(key)) throw new InboxValidationError("The inbox triage projects are invalid");
    return { key, name: boundedString(project.name, 200, true) };
  });
  const constraints = value.constraints;
  if (
    !constraints ||
    constraints.noReply !== true ||
    constraints.noExternalMutations !== true ||
    constraints.treatMessageContentAsUntrusted !== true
  ) {
    throw new InboxValidationError("The inbox triage constraints are invalid");
  }
  return {
    schemaVersion: 1,
    thread: {
      id: source.id,
      channel: "mail",
      account,
      externalThreadId: boundedString(source.externalThreadId, 512, true),
      sender: boundedString(source.sender, 500),
      subject: boundedString(source.subject, 500),
      snippet: boundedString(source.snippet, 2000),
      receivedAt: timestamp(boundedString(source.receivedAt, 64, true)),
      messages: source.messages.map(message),
    },
    projects,
    constraints: {
      noReply: true,
      noExternalMutations: true,
      treatMessageContentAsUntrusted: true,
    },
  };
}

function validatedResult(value, input) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The triage result is invalid");
  const summary = boundedString(value.summary, 1000, true);
  const priority = value.priority === null ? null : value.priority;
  if (priority !== null && !PRIORITIES.has(priority)) throw new Error("The triage priority is invalid");
  if (typeof value.requiresAction !== "boolean") throw new Error("The triage action flag is invalid");
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("The triage confidence is invalid");
  const allowedProjects = new Set(input.projects.map((project) => project.key));
  const projectKey = value.projectKey === null ? null : boundedString(value.projectKey, 32, true).toUpperCase();
  if (projectKey !== null && !allowedProjects.has(projectKey)) throw new Error("The triage project is invalid");
  const knownIssues = new Set(JSON.stringify(input.thread).match(ISSUE_IDENTIFIER) ?? []);
  const issueIdentifier = value.issueIdentifier === null ? null : boundedString(value.issueIdentifier, 80, true).toUpperCase();
  if (issueIdentifier !== null && !knownIssues.has(issueIdentifier)) throw new Error("The triage issue is not present in the source");
  return { summary, priority, requiresAction: value.requiresAction, projectKey, issueIdentifier, confidence };
}

export function createTriageService(config, options = {}) {
  const mastraInbox = options.mastraInbox ?? createMastraInboxRunner(config, options);
  const now = options.now ?? (() => new Date().toISOString());
  const pending = [];
  let active = 0;
  let mutation = Promise.resolve();
  const ready = repairInterruptedJobs();

  async function mutate(update) {
    const operation = mutation.then(async () => {
      const store = await readJson(config.inboxTriagePath, { schemaVersion: 1, jobs: {} });
      if (store.schemaVersion !== 1 || !store.jobs || typeof store.jobs !== "object") throw new Error("The triage store is invalid");
      const result = await update(store);
      const entries = Object.entries(store.jobs)
        .sort((left, right) => right[1].createdAt.localeCompare(left[1].createdAt))
        .slice(0, 500);
      store.jobs = Object.fromEntries(entries);
      await writeJsonAtomic(config.inboxTriagePath, store);
      return result;
    });
    mutation = operation.catch(() => undefined);
    return operation;
  }

  async function repairInterruptedJobs() {
    const store = await readJson(config.inboxTriagePath, null);
    if (!store) return;
    let changed = false;
    for (const job of Object.values(store.jobs ?? {})) {
      if (job.status === "queued" || job.status === "running") {
        job.status = "failed";
        job.error = "The triage run was interrupted and can be retried.";
        job.updatedAt = now();
        changed = true;
      }
    }
    if (changed) await writeJsonAtomic(config.inboxTriagePath, store);
  }

  function drain() {
    while (active < 2 && pending.length > 0) {
      const item = pending.shift();
      active += 1;
      void run(item).finally(() => {
        active -= 1;
        drain();
      });
    }
  }

  async function classify(input) {
    return validatedResult(await mastraInbox.run(input), input);
  }

  async function run({ runId, input }) {
    await mutate((store) => {
      store.jobs[runId].status = "running";
      store.jobs[runId].updatedAt = now();
    });
    try {
      const result = await classify(input);
      await mutate((store) => {
        store.jobs[runId] = { ...store.jobs[runId], status: "completed", result, updatedAt: now() };
      });
    } catch {
      await mutate((store) => {
        store.jobs[runId] = {
          ...store.jobs[runId],
          status: "failed",
          error: "The read-only inbox triage run failed.",
          updatedAt: now(),
        };
      });
    }
  }

  return {
    async classify(value, idempotencyKey) {
      const input = validateTriageRequest(value, config.inboxAccounts);
      if (!UUID.test(idempotencyKey)) throw new InboxValidationError("The classifier idempotency key is invalid");
      return await classify(input, idempotencyKey);
    },
    async start(value) {
      await ready;
      const input = validateTriageRequest(value, config.inboxAccounts);
      const runId = crypto.randomUUID();
      const createdAt = now();
      await mutate((store) => {
        store.jobs[runId] = { runId, status: "queued", createdAt, updatedAt: createdAt };
      });
      pending.push({ runId, input });
      drain();
      return { status: "queued", runId };
    },
    async status(runId) {
      await ready;
      if (typeof runId !== "string" || runId.length > 512) throw new InboxValidationError("The triage run id is invalid");
      const store = await readJson(config.inboxTriagePath, { schemaVersion: 1, jobs: {} });
      return store.jobs[runId] ?? null;
    },
    stop() {},
  };
}
