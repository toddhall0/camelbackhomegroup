// Sending and reply sync against real Postgres, with Microsoft stood in for at the network edge
const { test, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase, loadHandler } = require("./helpers");

const AGENT_AUTH = "00000000-0000-0000-0000-00000000000a";
const OTHER_AUTH = "00000000-0000-0000-0000-00000000000b";
const ADMIN_AUTH = "00000000-0000-0000-0000-00000000000c";

let db, send, sync, leadId, realFetch, graphCalls, inbox, failSend;

const call = async (token, input) => {
  const res = await send({ httpMethod: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  return { status: res.statusCode, json: JSON.parse(res.body) };
};
const email = (extra = {}) => ({ leadId, subject: "Hello", body: "About that house", ...extra });
const messages = async () => (await db.query("SELECT * FROM messages ORDER BY created_at")).rows;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

before(async () => {
  db = await createDatabase();
  send = loadHandler(db, "crm-email");
  sync = loadHandler(db, "crm-email-sync");
  await db.exec(`INSERT INTO auth.users (id) VALUES ('${AGENT_AUTH}'), ('${OTHER_AUTH}'), ('${ADMIN_AUTH}')`);
  await db.query(
    `INSERT INTO agents (auth_id, first_name, last_name, email, phone, role) VALUES
       ($1, 'Ana', 'Agent', 'ana@chg.test', '480-555-0001', 'agent'),
       ($2, 'Oli', 'Other', 'oli@chg.test', NULL, 'agent'),
       ($3, 'Ada', 'Admin', 'ada@chg.test', NULL, 'admin')`,
    [AGENT_AUTH, OTHER_AUTH, ADMIN_AUTH]
  );
  const { rows } = await db.query(
    `INSERT INTO leads (email, first_name, assigned_agent_id) VALUES ('buyer@test.com', 'Bea', (SELECT id FROM agents WHERE email = 'ana@chg.test')) RETURNING id`
  );
  leadId = rows[0].id;
});

beforeEach(async () => {
  await db.query("DELETE FROM messages");
  await db.query("DELETE FROM activities");
  await db.query("UPDATE leads SET email_opt_out = false, last_active_at = NULL");
  Object.assign(process.env, { MS_TENANT_ID: "tenant", MS_CLIENT_ID: "client", MS_CLIENT_SECRET: "secret" });
  graphCalls = [];
  inbox = {};
  failSend = false;
  realFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.includes("login.microsoftonline.com")) return json({ access_token: "token" });
    graphCalls.push({ url, method: init.method || "GET", body: init.body && JSON.parse(init.body) });
    if (url.includes("/mailFolders/inbox/")) {
      const mailbox = decodeURIComponent(url.split("/users/")[1].split("/")[0]);
      if (mailbox === "oli@chg.test" && inbox.oliFails) return json({ error: { message: "mailbox not allowed" } }, 403);
      return json({ value: inbox[mailbox] || [] });
    }
    if (failSend) return json({ error: { message: "Access denied" } }, 403);
    if (url.endsWith("/sendMail")) return new Response(null, { status: 202 });
    return json({ error: { message: "Access is denied. Check credentials and try again." } }, 403);
  };
});

afterEach(() => {
  global.fetch = realFetch;
});

test("an agent's email goes from their own mailbox and is recorded", async () => {
  const { status, json: result } = await call(AGENT_AUTH, email());
  assert.equal(status, 200);
  assert.equal(result.recorded, true);

  // One sendMail call, which Mail.Send alone allows; a draft would need Mail.ReadWrite
  assert.equal(graphCalls.length, 1);
  assert.match(graphCalls[0].url, /users\/ana%40chg\.test\/sendMail$/);
  assert.equal(graphCalls[0].body.message.toRecipients[0].emailAddress.address, "buyer@test.com");
  assert.equal(graphCalls[0].body.message.body.contentType, "Text");
  assert.equal(graphCalls[0].body.saveToSentItems, true);

  const [saved] = await messages();
  assert.equal(saved.status, "sent");
  assert.match(saved.body, /About that house\n\n--\nAna Agent\nCamelback Home Group\n480-555-0001/);
  const { rows } = await db.query("SELECT type, message, created_by FROM activities WHERE lead_id = $1", [leadId]);
  assert.equal(rows[0].type, "email_sent");
  assert.ok(rows[0].created_by);
});

test("only a signed-in assigned agent or an admin can send", async () => {
  assert.equal((await call("expired", email())).status, 401);
  assert.equal((await call("00000000-0000-0000-0000-0000000000ff", email())).status, 401);
  assert.equal((await call(OTHER_AUTH, email())).status, 403);
  assert.equal(graphCalls.length, 0);
  assert.equal((await call(ADMIN_AUTH, email())).status, 200);
  assert.match(graphCalls[0].url, /ada%40chg\.test/);
});

test("nothing sends to an opted-out lead, or when fields are missing", async () => {
  assert.equal((await call(AGENT_AUTH, email({ subject: " " }))).status, 400);
  assert.equal((await call(AGENT_AUTH, email({ body: "" }))).status, 400);
  assert.equal((await call(AGENT_AUTH, email({ leadId: "00000000-0000-0000-0000-000000000000" }))).status, 404);
  await db.query("UPDATE leads SET email_opt_out = true");
  assert.equal((await call(AGENT_AUTH, email())).status, 400);
  assert.equal(graphCalls.length, 0);
});

test("a failed send is kept and reported, and isn't logged as sent", async () => {
  failSend = true;
  const { status } = await call(AGENT_AUTH, email());
  assert.equal(status, 502);
  const [saved] = await messages();
  assert.equal(saved.status, "failed");
  assert.equal(saved.error, "Access denied");
  assert.equal((await db.query("SELECT id FROM activities")).rows.length, 0);
});

test("without Microsoft settings the send explains itself", async () => {
  delete process.env.MS_CLIENT_SECRET;
  const { status, json: result } = await call(AGENT_AUTH, email());
  assert.equal(status, 503);
  assert.match(result.error, /isn't connected/);
  assert.equal((await sync()).statusCode, 200);
});

test("sync saves mail from leads once and ignores everything else", async () => {
  inbox["ana@chg.test"] = [
    { internetMessageId: "<r1@x>", subject: "Re: Hello", from: { emailAddress: { address: "Buyer@Test.com" } }, receivedDateTime: "2026-11-02T10:00:00Z", uniqueBody: { content: " Yes please \n" } },
    { internetMessageId: "<private@x>", subject: "Your attorney invoice", from: { emailAddress: { address: "someone@else.com" } }, receivedDateTime: "2026-11-02T11:00:00Z", uniqueBody: { content: "private" } },
  ];
  assert.equal(JSON.parse((await sync()).body).saved, 1);
  assert.equal(JSON.parse((await sync()).body).saved, 0);

  const saved = await messages();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].body, "Yes please");
  assert.equal(saved[0].direction, "inbound");
  assert.equal(saved[0].read_at, null);
  assert.ok(!JSON.stringify(saved).includes("attorney"));

  const { rows } = await db.query("SELECT type FROM activities WHERE lead_id = $1", [leadId]);
  assert.deepEqual(rows.map((r) => r.type), ["email_received"]);
  const lead = await db.query("SELECT last_active_at FROM leads WHERE id = $1", [leadId]);
  assert.ok(lead.rows[0].last_active_at);
});

test("one failing mailbox does not stop the others", async () => {
  inbox.oliFails = true;
  inbox["ada@chg.test"] = [
    { internetMessageId: "<r2@x>", subject: "Hi", from: { emailAddress: { address: "buyer@test.com" } }, receivedDateTime: "2026-11-02T10:00:00Z", uniqueBody: { content: "Hi" } },
  ];
  assert.equal(JSON.parse((await sync()).body).saved, 1);
});
