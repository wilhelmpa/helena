const MAX_RESPONSE_BYTES = 64 * 1024;
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const WORKFLOW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJECT_REF = /^project:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RUN_STATUS = /^[a-z][a-z0-9_-]{0,31}$/;

export class MastraEventError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "MastraEventError";
    this.status = status;
    this.code = code;
  }
}

function responseValue(raw) {
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
    throw new MastraEventError(502, "invalid_event_response", "Mastra event response is too large");
  }
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    throw new MastraEventError(502, "invalid_event_response", "Mastra event response is invalid");
  }
}

function result(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.eventId !== "string" ||
    !EVENT_ID.test(value.eventId) ||
    typeof value.eventType !== "string" ||
    value.eventType.length > 100 ||
    typeof value.workflowId !== "string" ||
    !WORKFLOW_ID.test(value.workflowId) ||
    typeof value.projectRef !== "string" ||
    !PROJECT_REF.test(value.projectRef) ||
    typeof value.runId !== "string" ||
    !EVENT_ID.test(value.runId) ||
    typeof value.status !== "string" ||
    !RUN_STATUS.test(value.status) ||
    typeof value.replayed !== "boolean"
  ) {
    throw new MastraEventError(502, "invalid_event_response", "Mastra event response is invalid");
  }
  return {
    eventId: value.eventId,
    eventType: value.eventType,
    workflowId: value.workflowId,
    projectRef: value.projectRef,
    runId: value.runId,
    status: value.status,
    replayed: value.replayed,
  };
}

export function createMastraEventService(config, options = {}) {
  const request = options.fetch ?? fetch;
  return {
    async emit(input) {
      let response;
      try {
        response = await request(config.mastraEventUrl, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(340_000),
          headers: {
            authorization: "Bearer " + config.mastraEventToken,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(input),
        });
      } catch {
        throw new MastraEventError(502, "event_ingress_unavailable", "Mastra event ingress is unavailable");
      }
      const raw = await response.text();
      let value;
      try {
        value = responseValue(raw);
      } catch (error) {
        if (response.ok) throw error;
        value = null;
      }
      if (!response.ok) {
        const allowed = new Set([400, 403, 409, 413, 415, 422]);
        const status = allowed.has(response.status) ? response.status : 502;
        const code =
          value && typeof value.error === "string" && value.error.length <= 80
            ? value.error
            : "event_ingress_failed";
        const message =
          value && typeof value.message === "string" && value.message.length <= 300
            ? value.message
            : "Mastra rejected the event";
        throw new MastraEventError(status, code, message);
      }
      return result(value);
    },
  };
}
