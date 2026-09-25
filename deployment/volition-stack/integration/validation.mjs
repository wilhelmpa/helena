import { publicOrigin } from "./config.mjs";
const EVENT_TYPES = new Set(["project.provision", "project.deprovision"]);
const PROJECT_KEY = /^[A-Z][A-Z0-9]{0,31}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// One path segment below the workspace and the vault project folder, never one of the
// folders the provisioner manages there itself. Plan applies the same rule.
export const AREA_FOLDER = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const RESERVED_AREA_FOLDERS = new Set(["assets", "boards", "docs", "files", "inbox"]);
const RESOURCE_KINDS = new Set([
  "coordinator",
  "workspace",
  "files",
  "browser",
  "terminal",
  "boards",
  "workflows",
]);

export class RequestValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requiredString(value, name, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    throw new RequestValidationError(`${name} is invalid`);
  }
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RequestValidationError(`${name} is invalid`);
  }
  return value;
}

export function validateEnvelope(value, headers) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError("The request body must be an object");
  }
  const eventId = requiredString(value.eventId, "eventId", 36);
  if (!UUID.test(eventId))
    throw new RequestValidationError("eventId is invalid");
  if (headers.idempotencyKey !== eventId) {
    throw new RequestValidationError("Idempotency-Key must match eventId");
  }
  if (
    typeof value.eventType !== "string" ||
    !EVENT_TYPES.has(value.eventType) ||
    headers.eventType !== value.eventType
  ) {
    throw new RequestValidationError("The event type is invalid");
  }
  if (headers.eventId && headers.eventId !== eventId) {
    throw new RequestValidationError("X-Itsaplan-Event-Id must match eventId");
  }

  const project = value.project;
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new RequestValidationError("project is invalid");
  }
  const key = requiredString(project.key, "project.key", 32);
  if (!PROJECT_KEY.test(key)) {
    throw new RequestValidationError(
      "project.key must be an uppercase safe key",
    );
  }
  const description = project.description ?? "";
  if (typeof description !== "string" || description.length > 2000) {
    throw new RequestValidationError("project.description is invalid");
  }
  if (
    !Array.isArray(value.requestedResources) ||
    value.requestedResources.length > 256
  ) {
    throw new RequestValidationError("requestedResources is invalid");
  }
  const requestedResources = [];
  for (const resource of value.requestedResources) {
    if (typeof resource !== "string" || (!RESOURCE_KINDS.has(resource) && !/^board:[1-9][0-9]{0,9}$/.test(resource))) {
      throw new RequestValidationError(
        "requestedResources contains an unsupported value",
      );
    }
    if (!requestedResources.includes(resource))
      requestedResources.push(resource);
  }
  const boards = value.boards ?? [];
  if (!Array.isArray(boards) || boards.length > 200) throw new RequestValidationError("boards is invalid");
  if (value.eventType === "project.deprovision" && boards.length > 0) {
    throw new RequestValidationError("boards are not accepted for deprovisioning");
  }
  const ids = new Set();
  const cleanBoards = boards.map((board) => {
    if (!board || typeof board !== "object") throw new RequestValidationError("board is invalid");
    const id = positiveInteger(board.id, "board.id");
    if (ids.has(id) || board.resource !== `board:${id}` || !requestedResources.includes(board.resource)) throw new RequestValidationError("board does not match a requested resource");
    ids.add(id);
    const slug = requiredString(board.slug, "board.slug", 32);
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug)) throw new RequestValidationError("board.slug is invalid");
    let folder = null;
    if (board.folder != null) {
      const folderSlug = requiredString(board.folder.slug, "board.folder.slug", 32);
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(folderSlug)) throw new RequestValidationError("board.folder.slug is invalid");
      folder = { id: positiveInteger(board.folder.id, "board.folder.id"), name: requiredString(board.folder.name, "board.folder.name", 100), slug: folderSlug };
    }
    return { id, resource: board.resource, name: requiredString(board.name, "board.name", 100), slug, folder };
  });
  for (const resource of requestedResources) {
    if (value.eventType === "project.deprovision") break;
    if (resource.startsWith("board:") && !ids.has(Number(resource.slice(6)))) throw new RequestValidationError("Requested board metadata is missing");
  }
  const agents = value.agents ?? [];
  if (!Array.isArray(agents) || agents.length > 200) throw new RequestValidationError("agents is invalid");
  if (value.eventType === "project.deprovision" && agents.length > 0) {
    throw new RequestValidationError("agents are not accepted for deprovisioning");
  }
  for (const agent of agents) positiveInteger(agent, "agent id");
  if (new Set(agents).size !== agents.length) throw new RequestValidationError("agents contains a duplicate");
  const areas = value.areas ?? [];
  if (!Array.isArray(areas) || areas.length > 1000) throw new RequestValidationError("areas is invalid");
  if (value.eventType === "project.deprovision" && areas.length > 0) {
    throw new RequestValidationError("areas are not accepted for deprovisioning");
  }
  const cleanAreas = areas.map((area) => {
    if (!area || typeof area !== "object") throw new RequestValidationError("area is invalid");
    const folder = requiredString(area.folder, "area.folder", 64);
    if (!AREA_FOLDER.test(folder) || RESERVED_AREA_FOLDERS.has(folder)) {
      throw new RequestValidationError("area.folder is invalid");
    }
    return {
      id: positiveInteger(area.id, "area.id"),
      name: requiredString(area.name, "area.name", 100),
      folder,
    };
  });
  if (
    new Set(cleanAreas.map((area) => area.id)).size !== cleanAreas.length ||
    new Set(cleanAreas.map((area) => area.folder)).size !== cleanAreas.length
  ) {
    throw new RequestValidationError("areas contains a duplicate");
  }
  // Helena's public origin (its first APP_URL), which the links written for the agents use.
  let publicUrl = "";
  if (value.publicUrl != null) {
    if (typeof value.publicUrl !== "string" || value.publicUrl.length > 300) {
      throw new RequestValidationError("publicUrl is invalid");
    }
    try {
      publicUrl = publicOrigin(value.publicUrl);
    } catch {
      throw new RequestValidationError("publicUrl must be a bare http(s) origin");
    }
  }
  const createdAt = requiredString(value.createdAt, "createdAt", 40);
  const created = new Date(createdAt);
  if (
    !Number.isFinite(created.getTime()) ||
    created.toISOString() !== createdAt
  ) {
    throw new RequestValidationError("createdAt must be an ISO timestamp");
  }

  return {
    eventId,
    eventType: value.eventType,
    project: {
      id: positiveInteger(project.id, "project.id"),
      key,
      name: requiredString(project.name, "project.name", 200),
      description,
      teamId: positiveInteger(project.teamId, "project.teamId"),
    },
    requestedResources,
    ...(cleanBoards.length ? { boards: cleanBoards } : {}),
    ...(agents.length ? { agents } : {}),
    ...(cleanAreas.length ? { areas: cleanAreas } : {}),
    ...(publicUrl ? { publicUrl } : {}),
    createdAt,
  };
}

export function isUuid(value) {
  return typeof value === "string" && UUID.test(value);
}
