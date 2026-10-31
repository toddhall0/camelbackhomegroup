const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDatabase } = require("./helpers");

const ADMIN_AUTH = "00000000-0000-0000-0000-00000000000a";
const AGENT_AUTH = "00000000-0000-0000-0000-00000000000b";
const OTHER_AUTH = "00000000-0000-0000-0000-00000000000c";
const FORMER_AUTH = "00000000-0000-0000-0000-00000000000d";

let db, agentId, otherId, ownLead, otherLead;

// Runs a statement as a dashboard user (or anon) inside a rolled-back transaction
async function asUser(role, authId, sql, params) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${authId || ""}', true);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("ROLLBACK");
  }
}

before(async () => {
  db = await createDatabase();
  await db.exec(`INSERT INTO auth.users (id) VALUES ('${ADMIN_AUTH}'), ('${AGENT_AUTH}'), ('${OTHER_AUTH}'), ('${FORMER_AUTH}')`);
  await db.query(
    `INSERT INTO agents (auth_id, first_name, last_name, email, role, is_active) VALUES
       ($1, 'A', 'Admin', 'admin@test', 'admin', true),
       ($2, 'B', 'Agent', 'agent@test', 'agent', true),
       ($3, 'C', 'Agent', 'other@test', 'agent', true),
       ($4, 'D', 'Former', 'former@test', 'agent', false)`,
    [ADMIN_AUTH, AGENT_AUTH, OTHER_AUTH, FORMER_AUTH]
  );
  const agents = await db.query("SELECT id, email FROM agents");
  agentId = agents.rows.find((a) => a.email === "agent@test").id;
  otherId = agents.rows.find((a) => a.email === "other@test").id;
  const leads = await db.query(
    `INSERT INTO leads (email, password_hash, assigned_agent_id) VALUES ('own@test', 'hash', $1), ('other@test', 'hash', $2) RETURNING id`,
    [agentId, otherId]
  );
  [ownLead, otherLead] = leads.rows.map((r) => r.id);
});

test("every public table has RLS enabled", async () => {
  const { rows } = await db.query(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`);
  assert.deepEqual(rows, []);
  const { rows: count } = await db.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
  assert.equal(count[0].n, 15);
});

test("API roles have table access without relying on Supabase defaults", async () => {
  const { rows } = await db.query(`SELECT tablename,
      has_table_privilege('service_role', 'public.' || tablename, 'SELECT, INSERT, UPDATE, DELETE') AS server,
      has_table_privilege('authenticated', 'public.' || tablename, 'SELECT') AS dashboard
    FROM pg_tables WHERE schemaname = 'public'`);
  for (const row of rows) {
    assert.ok(row.server, row.tablename);
    assert.equal(row.dashboard, row.tablename !== "leads", row.tablename);
  }
});

test("every lead column the dashboard requests is readable by agents", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "crm", "crm-app.js"), "utf8");
  const match = /LEAD_COLUMNS = ([\s\S]*?);/.exec(source);
  const columns = match[1].replace(/['+\s]/g, "");
  assert.ok(!columns.includes("password_hash"));
  assert.equal((await asUser("authenticated", AGENT_AUTH, `SELECT ${columns} FROM leads`)).rows.length, 2);
});

test("agents can make the dashboard's lead edits on assigned leads", async () => {
  const { rows } = await asUser(
    "authenticated",
    AGENT_AUTH,
    `UPDATE leads SET first_name = 'P', last_name = 'L', email = 'new@test', phone = '1', lead_type = 'seller', status = 'qualified',
       min_price = 1, max_price = 2, tags = '{a}', email_opt_out = true, assigned_agent_id = $1 WHERE id = $2 RETURNING id`,
    [otherId, ownLead]
  );
  assert.equal(rows.length, 1);
  const added = await asUser(
    "authenticated",
    AGENT_AUTH,
    `INSERT INTO leads (first_name, email, lead_type, source, source_detail, assigned_agent_id) VALUES ('N', 'n@test', 'buyer', 'manual', 'x', $1) RETURNING id`,
    [agentId]
  );
  assert.equal(added.rows.length, 1);
});

test("anon cannot read or write anything", async () => {
  await assert.rejects(asUser("anon", null, "SELECT id FROM leads"), /permission denied/);
  await assert.rejects(asUser("anon", null, "INSERT INTO leads (email) VALUES ('x@test')"), /permission denied/);
  for (const table of ["agents", "activities", "favorites", "tasks", "scoring_rules", "chat_messages"]) {
    assert.equal((await asUser("anon", null, `SELECT 1 FROM ${table}`)).rows.length, 0, table);
  }
  await assert.rejects(asUser("anon", null, "SELECT assign_lead_round_robin(gen_random_uuid())"), /permission denied/);
});

test("logged-in user who is not an active agent sees nothing", async () => {
  assert.equal((await asUser("authenticated", FORMER_AUTH, "SELECT id FROM leads")).rows.length, 0);
  assert.equal((await asUser("authenticated", FORMER_AUTH, "SELECT id FROM agents")).rows.length, 0);
});

test("agents read all leads but never password_hash", async () => {
  assert.equal((await asUser("authenticated", AGENT_AUTH, "SELECT id, email FROM leads")).rows.length, 2);
  await assert.rejects(asUser("authenticated", AGENT_AUTH, "SELECT password_hash FROM leads"), /permission denied/);
  await assert.rejects(asUser("authenticated", ADMIN_AUTH, "SELECT * FROM leads"), /permission denied/);
  await assert.rejects(asUser("authenticated", ADMIN_AUTH, "UPDATE leads SET password_hash = 'x'"), /permission denied/);
});

test("agents update assigned leads only; admins update any", async () => {
  const update = "UPDATE leads SET status = 'contacted' WHERE id = $1 RETURNING id";
  assert.equal((await asUser("authenticated", AGENT_AUTH, update, [ownLead])).rows.length, 1);
  assert.equal((await asUser("authenticated", AGENT_AUTH, update, [otherLead])).rows.length, 0);
  assert.equal((await asUser("authenticated", ADMIN_AUTH, update, [otherLead])).rows.length, 1);
});

test("only admins delete leads or change the team", async () => {
  assert.equal((await asUser("authenticated", AGENT_AUTH, "DELETE FROM leads WHERE id = $1 RETURNING id", [ownLead])).rows.length, 0);
  assert.equal((await asUser("authenticated", ADMIN_AUTH, "DELETE FROM leads WHERE id = $1 RETURNING id", [ownLead])).rows.length, 1);
  assert.equal((await asUser("authenticated", AGENT_AUTH, "UPDATE agents SET role = 'admin' WHERE id = $1 RETURNING id", [agentId])).rows.length, 0);
});

test("agents cannot log activity as someone else, or edit website activity", async () => {
  await assert.rejects(
    asUser("authenticated", AGENT_AUTH, "INSERT INTO activities (lead_id, type, created_by) VALUES ($1, 'note', $2)", [ownLead, otherId]),
    /row-level security/
  );
  await db.query("INSERT INTO activities (lead_id, type) VALUES ($1, 'site_visit')", [ownLead]);
  assert.equal((await asUser("authenticated", AGENT_AUTH, "UPDATE activities SET message = 'x' RETURNING id")).rows.length, 0);
});

test("round robin skips paralegals and inactive agents, and rotates", async () => {
  await db.exec("BEGIN");
  await db.exec("UPDATE leads SET assigned_agent_id = NULL; INSERT INTO agents (first_name, last_name, email, role) VALUES ('P', 'L', 'para@test', 'paralegal')");
  const assigned = [];
  for (const email of ["r1@test", "r2@test", "r3@test", "r4@test"]) {
    const { rows } = await db.query("INSERT INTO leads (email) VALUES ($1) RETURNING id", [email]);
    const result = await db.query("SELECT assign_lead_round_robin($1) AS id", [rows[0].id]);
    assigned.push(result.rows[0].id);
    await db.exec("SELECT pg_sleep(0.01)");
    await db.query("UPDATE leads SET created_at = clock_timestamp() WHERE id = $1", [rows[0].id]);
  }
  const { rows: pool } = await db.query("SELECT id FROM agents WHERE is_active AND role IN ('admin', 'agent')");
  assert.equal(new Set(assigned.slice(0, 3)).size, 3);
  assert.equal(assigned[3], assigned[0]);
  for (const id of assigned) assert.ok(pool.some((a) => a.id === id));
  await db.exec("ROLLBACK");
});
