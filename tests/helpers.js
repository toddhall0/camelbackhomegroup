// Test harness: real Postgres (PGlite) with the real migration, and a stand-in
// for @supabase/supabase-js that turns its query-builder calls into SQL.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { PGlite } = require("@electric-sql/pglite");

const MIGRATION = path.join(__dirname, "..", "supabase", "migrations", "20261030000000_crm_schema.sql");

// The parts of a Supabase project the migration relies on
const SUPABASE_BOOTSTRAP = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id UUID PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
`;

async function createDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_BOOTSTRAP);
  await db.exec(fs.readFileSync(MIGRATION, "utf8"));
  return db;
}

class Query {
  constructor(pg, table) {
    Object.assign(this, { pg, table, op: "select", columns: null, returning: null, filters: [], tail: "", mode: "many" });
  }
  select(columns = "*") {
    if (this.op === "select") this.columns = columns;
    else this.returning = columns;
    return this;
  }
  insert(row) {
    return Object.assign(this, { op: "insert", row });
  }
  upsert(row, { onConflict, ignoreDuplicates }) {
    if (!ignoreDuplicates) throw new Error("harness only supports ignoreDuplicates upserts");
    return Object.assign(this, { op: "insert", row, conflict: onConflict });
  }
  update(row) {
    return Object.assign(this, { op: "update", row });
  }
  delete() {
    return Object.assign(this, { op: "delete" });
  }
  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }
  order(column) {
    this.tail += ` ORDER BY ${column}`;
    return this;
  }
  limit(n) {
    this.tail += ` LIMIT ${Number(n)}`;
    return this;
  }
  single() {
    return Object.assign(this, { mode: "single" });
  }
  maybeSingle() {
    return Object.assign(this, { mode: "maybe" });
  }
  build() {
    const params = [];
    const bind = (value) => `$${params.push(value)}`;
    const where = () =>
      this.filters.length ? ` WHERE ${this.filters.map(([c, v]) => `${c} = ${bind(v)}`).join(" AND ")}` : "";
    const returning = this.returning ? ` RETURNING ${this.returning}` : "";

    if (this.op === "select") return [`SELECT ${this.columns} FROM ${this.table}${where()}${this.tail}`, params];
    if (this.op === "delete") return [`DELETE FROM ${this.table}${where()}${returning}`, params];
    if (this.op === "update") {
      const sets = Object.entries(this.row).map(([c, v]) => `${c} = ${bind(v)}`);
      return [`UPDATE ${this.table} SET ${sets.join(", ")}${where()}${returning}`, params];
    }
    const columns = Object.keys(this.row);
    const values = columns.map((c) => bind(this.row[c]));
    const conflict = this.conflict ? ` ON CONFLICT (${this.conflict}) DO NOTHING` : "";
    return [`INSERT INTO ${this.table} (${columns.join(", ")}) VALUES (${values.join(", ")})${conflict}${returning}`, params];
  }
  async run() {
    try {
      const [sql, params] = this.build();
      const { rows } = await this.pg.query(sql, params);
      if (this.mode === "many") return { data: rows, error: null };
      if (rows.length > 1 || (this.mode === "single" && !rows.length)) {
        return { data: null, error: { message: `expected one row, got ${rows.length}` } };
      }
      return { data: rows[0] || null, error: null };
    } catch (err) {
      return { data: null, error: { message: err.message } };
    }
  }
  then(resolve, reject) {
    return this.run().then(resolve, reject);
  }
}

// Loads netlify/functions/lead.js with supabase-js swapped for the SQL stand-in
function loadLeadHandler(pg) {
  process.env.SUPABASE_URL = "http://test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  const fake = {
    createClient: () => ({
      from: (table) => new Query(pg, table),
      rpc: async (name, args) => {
        try {
          const { rows } = await pg.query(`SELECT ${name}($1) AS result`, Object.values(args));
          return { data: rows[0].result, error: null };
        } catch (err) {
          return { data: null, error: { message: err.message } };
        }
      },
    }),
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === "@supabase/supabase-js" ? fake : originalLoad.call(this, request, ...rest);
  };
  try {
    const file = require.resolve("../netlify/functions/lead.js");
    delete require.cache[file];
    return require(file).handler;
  } finally {
    Module._load = originalLoad;
  }
}

module.exports = { createDatabase, loadLeadHandler };
