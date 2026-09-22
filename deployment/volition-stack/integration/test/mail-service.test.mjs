import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMailService, MailValidationError } from "../mail-service.mjs";

function service(execute, now = () => 1_700_000_000_000) {
  return createMailService(
    {
      inboxAccounts: ["owner@example.com", "second@example.com"],
      gogBin: "/opt/gog",
      gogHome: "/private/gog",
      gogKeyringPassword: "hidden-password",
      openClawRoot: "/home/owner/.openclaw",
    },
    { execute, now, randomBytes: () => Buffer.alloc(32, 7) },
  );
}

describe("mail service", () => {
  it("uses exact read-only commands for every account and never returns credentials", async () => {
    const calls = [];
    const mail = service(async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: JSON.stringify({ threads: [{ id: "t1", accessToken: "secret" }] }) };
    });
    const result = await mail.search({ account: "second@example.com", query: "is:unread", maxResults: 10 });
    assert.deepEqual(result, { threads: [{ id: "t1" }] });
    assert.equal(calls[0].file, "/opt/gog");
    assert.ok(calls[0].args.includes("--enable-commands-exact=gmail.search"));
    assert.ok(calls[0].args.includes("--readonly"));
    assert.ok(calls[0].args.includes("--gmail-no-send"));
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.env.GOG_KEYRING_PASSWORD, "hidden-password");
  });

  it("rejects an account outside the configured profiles", async () => {
    const mail = service(async () => ({ stdout: "{}" }));
    await assert.rejects(
      () => mail.search({ account: "attacker@example.com", query: "in:anywhere" }),
      MailValidationError,
    );
  });

  it("requires a fresh single-use confirmation before sending a draft", async () => {
    const commands = [];
    const mail = service(async (_file, args) => {
      commands.push(args);
      return { stdout: JSON.stringify({ id: "draft-1", message: { id: "message-1" } }) };
    });
    const auth = await mail.authorizeSend({ account: "owner@example.com", draftId: "draft-1" });
    assert.ok(!JSON.stringify(auth).includes("hidden-password"));
    await mail.sendDraft({ account: "owner@example.com", draftId: "draft-1", confirmationToken: auth.confirmationToken });
    await assert.rejects(
      () => mail.sendDraft({ account: "owner@example.com", draftId: "draft-1", confirmationToken: auth.confirmationToken }),
      MailValidationError,
    );
    assert.ok(commands[0].includes("--enable-commands-exact=gmail.drafts.get"));
    assert.ok(commands[1].includes("--enable-commands-exact=gmail.drafts.send"));
    assert.ok(!commands[1].includes("--gmail-no-send"));
  });

  it("keeps attachment responses bounded and strips unsafe filenames", async () => {
    const mail = service(async () => ({ stdout: JSON.stringify({ contentBase64: Buffer.from("safe").toString("base64") }) }));
    const result = await mail.attachment({ account: "owner@example.com", messageId: "m1", attachmentId: "a1", filename: "../bad\r\nname.pdf" });
    assert.equal(result.bytes.toString(), "safe");
    assert.equal(result.filename, "bad__name.pdf");
  });
});
