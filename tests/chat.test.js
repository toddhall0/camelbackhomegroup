const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase, loadHandler } = require("./helpers");

let db, handler, replies, claudeCalls;
const realFetch = globalThis.fetch;

const text = (value) => ({ stop_reason: "end_turn", content: [{ type: "text", text: value }] });
const captureTool = (input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "capture_lead", input }] });

async function chat(body) {
  const res = await handler({ httpMethod: "POST", body: JSON.stringify(body) });
  return JSON.parse(res.body);
}

const rows = async (sql, params) => (await db.query(sql, params)).rows;
const conversation = async (sessionId) => (await rows("SELECT * FROM chat_conversations WHERE session_id = $1", [sessionId]))[0];
const stored = async (id) =>
  (await rows("SELECT role, content FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at", [id])).map((m) => `${m.role}: ${m.content}`);

before(async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  db = await createDatabase();
  handler = loadHandler(db, "chat");
  await db.exec(`INSERT INTO agents (first_name, last_name, email) VALUES ('A', 'Agent', 'a@test')`);
  globalThis.fetch = async (url, init) => {
    assert.match(url, /api\.anthropic\.com/, "chat must not call Sierra");
    claudeCalls.push(JSON.parse(init.body));
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  };
});

beforeEach(() => {
  replies = [];
  claudeCalls = [];
});

after(() => {
  globalThis.fetch = realFetch;
});

test("anonymous chat is saved one exchange at a time, without repeats", async () => {
  replies = [text("Hi!"), text("Mesa is great.")];
  const first = await chat({ sessionId: "s1", messages: [{ role: "user", content: "Hello" }] });
  assert.equal(first.reply, "Hi!");
  await chat({
    sessionId: "s1",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "Tell me about Mesa" },
    ],
  });

  const convo = await conversation("s1");
  assert.equal(convo.lead_id, null);
  assert.equal(convo.message_count, 4);
  assert.ok(convo.last_message_at);
  assert.deepEqual(await stored(convo.id), [
    "user: Hello",
    "assistant: Hi!",
    "user: Tell me about Mesa",
    "assistant: Mesa is great.",
  ]);
});

test("capture_lead creates the lead and links the earlier conversation", async () => {
  replies = [text("Sure!")];
  await chat({ sessionId: "s2", messages: [{ role: "user", content: "Send me listings" }] });

  replies = [captureTool({ firstName: "Pat", email: "Pat@Test.com", phone: "480-555-0100", notes: "Wants 3 bed in Gilbert" }), text("Thanks Pat!")];
  const result = await chat({ sessionId: "s2", messages: [{ role: "user", content: "pat@test.com" }] });
  assert.equal(result.reply, "Thanks Pat!");

  const [lead] = await rows("SELECT * FROM leads WHERE email = 'pat@test.com'");
  assert.equal(lead.source, "chat");
  assert.equal(lead.source_detail, "Kathy AI Chat");
  assert.equal(lead.first_name, "Pat");
  assert.ok(lead.assigned_agent_id);

  const convo = await conversation("s2");
  assert.equal(convo.lead_id, lead.id);
  assert.equal((await stored(convo.id)).length, 4);

  const activities = (await rows("SELECT type, message FROM activities WHERE lead_id = $1", [lead.id]));
  const types = activities.map((a) => a.type).sort();
  assert.deepEqual(types, ["chat_message", "lead_created", "note"]);
  assert.equal(activities.find((a) => a.type === "note").message, "Wants 3 bed in Gilbert");

  const toolResult = claudeCalls.at(-1).messages.at(-1).content[0].content;
  assert.deepEqual(JSON.parse(toolResult), { saved: true });
});

test("capture_lead for an existing lead keeps it and does not reassign", async () => {
  await db.exec(`INSERT INTO leads (email, first_name) VALUES ('known@test.com', 'Known')`);
  replies = [captureTool({ email: "known@test.com", phone: "480-555-0199" }), text("Got it")];
  await chat({ sessionId: "s3", messages: [{ role: "user", content: "known@test.com" }] });
  const [lead] = await rows("SELECT * FROM leads WHERE email = 'known@test.com'");
  assert.equal(lead.first_name, "Known");
  assert.equal(lead.phone, "480-555-0199");
  assert.equal(lead.assigned_agent_id, null);
});

test("a logged-in visitor's chat links to their lead and counts as activity", async () => {
  await db.exec(`INSERT INTO leads (email) VALUES ('member@test.com')`);
  replies = [text("Hello again")];
  await chat({ sessionId: "s4", email: "Member@test.com", messages: [{ role: "user", content: "Hi" }] });
  const [lead] = await rows("SELECT * FROM leads WHERE email = 'member@test.com'");
  assert.equal((await conversation("s4")).lead_id, lead.id);
  assert.ok(lead.last_active_at);
});

test("an unknown email on the request creates no lead", async () => {
  replies = [text("Hi")];
  await chat({ sessionId: "s5", email: "stranger@test.com", messages: [{ role: "user", content: "Hi" }] });
  assert.equal((await rows("SELECT id FROM leads WHERE email = 'stranger@test.com'")).length, 0);
  assert.equal((await conversation("s5")).lead_id, null);
});

test("older cached widgets without a session id still get a reply", async () => {
  replies = [text("Hi")];
  const before = (await rows("SELECT count(*)::int AS n FROM chat_conversations"))[0].n;
  const result = await chat({ messages: [{ role: "user", content: "Hi" }] });
  assert.equal(result.reply, "Hi");
  assert.equal((await rows("SELECT count(*)::int AS n FROM chat_conversations"))[0].n, before);
});

test("Kathy keeps answering when the database is down", async () => {
  const healthy = handler;
  handler = loadHandler({ query: async () => { throw new Error("database down"); } }, "chat");
  try {
    replies = [captureTool({ email: "x@test.com" }), text("Still here")];
    const result = await chat({ sessionId: "s6", email: "x@test.com", messages: [{ role: "user", content: "Hi" }] });
    assert.equal(result.reply, "Still here");
    assert.deepEqual(JSON.parse(claudeCalls[1].messages.at(-1).content[0].content), { saved: false });
  } finally {
    handler = healthy;
  }
});
