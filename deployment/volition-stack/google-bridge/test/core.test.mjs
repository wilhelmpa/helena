import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleBridge, GoogleBridgeValidationError } from "../core.mjs";

function fake(outputs = []) {
  const calls = [];
  const execute = async (...args) => {
    calls.push(args);
    return { stdout: JSON.stringify(outputs.shift() ?? {}) };
  };
  return { calls, bridge: createGoogleBridge({ execute }) };
}

test("gmail thread read uses the read wrapper and exact command allowlist", async () => {
  const { calls, bridge } = fake([{ id: "abc", messages: [{ snippet: "safe" }] }]);
  const result = await bridge.gmailThreadGet({ account: "archive@example.com", threadId: "abc_123" });
  assert.equal(result.id, "abc");
  assert.equal(calls[0][0], "/home/pw/.local/bin/gog-openclaw-read");
  assert.ok(calls[0][1].includes("--enable-commands-exact=gmail.thread.get"));
  assert.ok(calls[0][1].includes("--sanitize-content"));
  assert.equal(calls[0][2].shell, false);
});

test("gmail search bounds count and keeps the query in one argv item", async () => {
  const { calls, bridge } = fake([{ threads: [] }]);
  await bridge.gmailSearch({ account: "personal@example.com", query: "from:test@example.com $(id)", maxResults: 20 });
  assert.ok(calls[0][1].includes("from:test@example.com $(id)"));
  assert.ok(calls[0][1].includes("--max=20"));
  assert.equal(calls[0][2].shell, false);
});

test("gmail search rejects leading option syntax", async () => {
  const { calls, bridge } = fake();
  await assert.rejects(
    bridge.gmailSearch({ account: "personal@example.com", query: "--help", maxResults: 1 }),
    GoogleBridgeValidationError,
  );
  assert.equal(calls.length, 0);
});

test("contacts use the native read wrapper and reject account or command escape", async () => {
  const { calls, bridge } = fake([{ contacts: [] }]);
  await bridge.contactsSearch({ account: "personal@example.com", query: "Ingrid $(id)", maxResults: 5 });
  assert.ok(calls[0][1].includes("--enable-commands-exact=contacts.search"));
  assert.ok(calls[0][1].includes("Ingrid $(id)"));
  assert.equal(calls[0][2].shell, false);
  for (const input of [
    { account: "other@example.com", query: "Ingrid" },
    { account: "personal@example.com", query: "--help" },
    { account: "personal@example.com", query: "Ingrid", maxResults: 26 },
    { account: "personal@example.com", query: "Ingrid", command: "send" },
  ]) await assert.rejects(bridge.contactsSearch(input), GoogleBridgeValidationError);
  assert.equal(calls.length, 1);
});

test("attachment metadata excludes bytes and limits fields", async () => {
  const { bridge } = fake([{ payload: { parts: [{ filename: "cv.pdf", mimeType: "application/pdf", body: { attachmentId: "att_1", size: 42, data: "secret" } }] } }]);
  const result = await bridge.gmailAttachmentMetadata({ account: "owner@example.com", messageId: "msg_1" });
  assert.deepEqual(result, { messageId: "msg_1", attachments: [{ messageId: "msg_1", attachmentId: "att_1", filename: "cv.pdf", mimeType: "application/pdf", size: 42 }] });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("calendar read allows all three configured accounts and rejects unknown accounts", async () => {
  const { calls, bridge } = fake([{ events: [] }, { events: [] }, { events: [] }]);
  for (const account of [
    "owner@example.com",
    "archive@example.com",
    "personal@example.com",
  ]) {
    await bridge.calendarList({ account, from: "2026-09-21T00:00:00+02:00", to: "2026-09-22T00:00:00+02:00" });
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call[1].includes("primary")));
  await assert.rejects(
    bridge.calendarList({ account: "other@example.com", from: "2026-09-21T00:00:00+02:00", to: "2026-09-22T00:00:00+02:00" }),
    GoogleBridgeValidationError,
  );
  assert.equal(calls.length, 3);
});

test("calendar upsert creates without attendees and forces notifications off", async () => {
  const { calls, bridge } = fake([{ events: [] }, { events: [] }, { id: "event_1", summary: "Confirmed call", start: { dateTime: "2026-09-23T10:00:00+02:00" }, end: { dateTime: "2026-09-23T11:00:00+02:00" } }]);
  const result = await bridge.calendarUpsertConfirmed({ account: "personal@example.com", confirmed: true, sourceId: "linkedin:conversation_123", summary: "Confirmed call", start: "2026-09-23T10:00:00+02:00" });
  assert.equal(result.action, "created");
  assert.ok(calls[0][1].some((arg) => arg.startsWith("--private-prop-filter=volitionSourceHash=")));
  assert.equal(calls[2][0], "/home/pw/.local/bin/gog-openclaw-write");
  assert.ok(calls[2][1].includes("--enable-commands-exact=calendar.create"));
  assert.ok(calls[2][1].includes("--send-updates=none"));
  assert.equal(calls[2][1].some((arg) => arg.startsWith("--attendees")), false);
  assert.equal(calls[2][2].shell, false);
});

test("calendar upsert deduplicates an exact source event", async () => {
  const event = { id: "event_1", summary: "Confirmed call", start: { dateTime: "2026-09-23T10:00:00+02:00" }, end: { dateTime: "2026-09-23T09:00:00.000Z" }, organizer: { self: true } };
  const { calls, bridge } = fake([{ events: [event] }]);
  const result = await bridge.calendarUpsertConfirmed({ account: "personal@example.com", confirmed: true, sourceId: "linkedin:conversation_123", summary: "Confirmed call", start: "2026-09-23T10:00:00+02:00" });
  assert.equal(result.action, "unchanged");
  assert.equal(calls.length, 1);
});

test("calendar upsert never adopts an unmanaged summary and time collision", async () => {
  const event = { id: "event_1", summary: "Confirmed call", start: { dateTime: "2026-09-23T10:00:00+02:00" }, end: { dateTime: "2026-09-23T11:00:00+02:00" }, organizer: { self: true } };
  const { calls, bridge } = fake([{ events: [] }, { events: [event] }]);
  const result = await bridge.calendarUpsertConfirmed({ account: "personal@example.com", confirmed: true, sourceId: "linkedin:conversation_123", summary: "Confirmed call", start: "2026-09-23T10:00:00+02:00" });
  assert.deepEqual({ action: result.action, reason: result.reason }, { action: "conflict", reason: "unmanaged_event_collision" });
  assert.equal(calls.length, 2);
});

test("calendar upsert never changes a managed event with attendees", async () => {
  const event = { id: "event_1", summary: "Confirmed call", start: { dateTime: "2026-09-23T10:00:00+02:00" }, end: { dateTime: "2026-09-23T11:00:00+02:00" }, organizer: { self: true }, attendees: [{ email: "guest@example.com" }] };
  const { calls, bridge } = fake([{ events: [event] }]);
  const result = await bridge.calendarUpsertConfirmed({ account: "personal@example.com", confirmed: true, sourceId: "linkedin:conversation_123", summary: "Changed title", start: "2026-09-23T10:00:00+02:00" });
  assert.deepEqual({ action: result.action, reason: result.reason }, { action: "conflict", reason: "managed_event_is_not_personal" });
  assert.equal(calls.length, 1);
});

test("calendar upsert never changes a managed event not owned by the calendar account", async () => {
  const event = { id: "event_1", summary: "Confirmed call", start: { dateTime: "2026-09-23T10:00:00+02:00" }, end: { dateTime: "2026-09-23T11:00:00+02:00" }, organizer: { self: false } };
  const { calls, bridge } = fake([{ events: [event] }]);
  const result = await bridge.calendarUpsertConfirmed({ account: "personal@example.com", confirmed: true, sourceId: "linkedin:conversation_123", summary: "Changed title", start: "2026-09-23T10:00:00+02:00" });
  assert.equal(result.action, "conflict");
  assert.equal(calls.length, 1);
});

test("calendar write rejects unconfirmed, attendees, shell-like source IDs, and bad times before execution", async () => {
  const { calls, bridge } = fake();
  const base = { account: "personal@example.com", confirmed: true, sourceId: "linkedin:item_1", summary: "Call", start: "2026-09-23T10:00:00+02:00" };
  await assert.rejects(bridge.calendarUpsertConfirmed({ ...base, confirmed: false }), GoogleBridgeValidationError);
  await assert.rejects(bridge.calendarUpsertConfirmed({ ...base, attendees: ["x@example.com"] }), GoogleBridgeValidationError);
  await assert.rejects(bridge.calendarUpsertConfirmed({ ...base, sourceId: "$(touch /tmp/x)" }), GoogleBridgeValidationError);
  await assert.rejects(bridge.calendarUpsertConfirmed({ ...base, start: "tomorrow" }), GoogleBridgeValidationError);
  await assert.rejects(bridge.calendarUpsertConfirmed({ ...base, account: "owner@example.com" }), GoogleBridgeValidationError);
  await assert.rejects(bridge.calendarUpsertConfirmed({ ...base, account: "archive@example.com" }), GoogleBridgeValidationError);
  assert.equal(calls.length, 0);
});

test("mail operations reject unknown accounts and path-like IDs", async () => {
  const { calls, bridge } = fake();
  await assert.rejects(bridge.gmailThreadGet({ account: "other@example.com", threadId: "abc" }), GoogleBridgeValidationError);
  await assert.rejects(bridge.gmailThreadGet({ account: "personal@example.com", threadId: "../../secret" }), GoogleBridgeValidationError);
  assert.equal(calls.length, 0);
});
