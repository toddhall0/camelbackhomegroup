const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase, loadLeadHandler } = require("./helpers");

let db, handler;

async function call(body) {
  const res = await handler({ httpMethod: "POST", body: JSON.stringify(body) });
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

const rows = async (sql, params) => (await db.query(sql, params)).rows;
const leadByEmail = async (email) => (await rows("SELECT * FROM leads WHERE email = $1", [email]))[0];
const activityTypes = async (leadId) =>
  (await rows("SELECT type FROM activities WHERE lead_id = $1 ORDER BY created_at, type", [leadId])).map((r) => r.type);

before(async () => {
  db = await createDatabase();
  handler = loadLeadHandler(db);
  await db.exec(`INSERT INTO agents (first_name, last_name, email) VALUES ('A', 'Agent', 'a@test')`);
  await db.exec(`
    WITH c AS (INSERT INTO drip_campaigns (name, trigger_type, trigger_value) VALUES ('Buyer', 'lead_created', 'buyer') RETURNING id)
    INSERT INTO drip_steps (campaign_id, step_order, delay_days, delay_hours) SELECT id, 1, 0, 2 FROM c;
    WITH c AS (INSERT INTO drip_campaigns (name, trigger_type, trigger_value) VALUES ('Seller', 'lead_created', 'seller') RETURNING id)
    INSERT INTO drip_steps (campaign_id, step_order, delay_days) SELECT id, 1, 0 FROM c;
  `);
});

test("rejects bad requests the way the Sierra function did", async () => {
  assert.equal((await handler({ httpMethod: "GET" })).statusCode, 405);
  assert.equal((await handler({ httpMethod: "OPTIONS" })).statusCode, 200);
  assert.equal((await handler({ httpMethod: "POST", body: "{" })).statusCode, 400);
  assert.equal((await call({ firstName: "Name only" })).status, 400); // popup step 1
  assert.equal((await call({ action: "update" })).status, 400);
  assert.equal((await call({ action: "saveListing", email: "x@test" })).status, 400);
  assert.equal((await call({ action: "addNote", email: "x@test" })).status, 400);
  assert.equal(await leadByEmail("x@test"), undefined);
});

test("create inserts the lead, assigns an agent, enrolls matching drips", async () => {
  const { json } = await call({ firstName: "Pat", lastName: "Lee", email: "Pat@Test.com ", source: "Website Popup (partial - name+email)" });
  assert.equal(json.success, true);
  assert.equal(json.crm, "supabase");

  const lead = await leadByEmail("pat@test.com");
  assert.equal(json.leadId, lead.id);
  assert.equal(lead.source, "website");
  assert.equal(lead.source_detail, "Website Popup (partial - name+email)");
  assert.ok(lead.assigned_agent_id);
  assert.deepEqual(await activityTypes(lead.id), ["lead_created"]);

  const enrollments = await rows(
    `SELECT c.name, e.next_send_at FROM drip_enrollments e JOIN drip_campaigns c ON c.id = e.campaign_id WHERE e.lead_id = $1`,
    [lead.id]
  );
  assert.deepEqual(enrollments.map((e) => e.name), ["Buyer"]);
  assert.ok(new Date(enrollments[0].next_send_at) > new Date(Date.now() + 3600000));
});

test("creating the same email twice keeps one lead and does not wipe fields", async () => {
  await call({ firstName: "Pat", email: "repeat@test.com", phone: "480-555-0100" });
  const first = await leadByEmail("repeat@test.com");
  const { json } = await call({ email: "REPEAT@test.com", lastName: "Lee" });
  assert.equal(json.leadId, first.id);

  const lead = await leadByEmail("repeat@test.com");
  assert.equal(lead.first_name, "Pat");
  assert.equal(lead.last_name, "Lee");
  assert.equal(lead.phone, "480-555-0100");
  assert.deepEqual(await activityTypes(lead.id), ["lead_created"]);
});

test("the three popup calls in order produce one complete lead", async () => {
  await call({ firstName: "Sam", lastName: "Ray", source: "Website Popup (partial - name)" });
  await call({ firstName: "Sam", lastName: "Ray", email: "sam@test.com", source: "Website Popup (partial - name+email)" });
  await call({ action: "update", email: "sam@test.com", phone: "480-555-0111", source: "Website Registration Popup" });
  const lead = await leadByEmail("sam@test.com");
  assert.equal(lead.phone, "480-555-0111");
  assert.equal(lead.source_detail, "Website Registration Popup");
});

test("property inquiry from an existing lead is still recorded", async () => {
  await call({ email: "buyer@test.com" });
  const inquiry = {
    email: "buyer@test.com",
    source: "Property Inquiry",
    propertyAddress: "1 Main St",
    propertyMlsId: "247121411",
    note: "Requested info on: 1 Main St",
  };
  await call(inquiry);
  await call({ ...inquiry, email: "newbuyer@test.com" });

  const existing = await leadByEmail("buyer@test.com");
  assert.ok((await activityTypes(existing.id)).includes("property_inquiry"));
  assert.equal((await leadByEmail("newbuyer@test.com")).source, "property_inquiry");
  const [activity] = await rows("SELECT * FROM activities WHERE lead_id = $1 AND type = 'property_inquiry'", [existing.id]);
  assert.equal(activity.property_id, "247121411");
  assert.equal(activity.message, inquiry.note);
});

test("phone-only leads are created and matched on phone", async () => {
  const a = await call({ phone: "480-555-0122", firstName: "Phone" });
  const b = await call({ phone: "480-555-0122" });
  assert.equal(a.json.success && a.json.crm, "supabase");
  assert.equal(a.json.leadId, b.json.leadId);
});

test("update maps fields, and legacy favorites notes are not logged", async () => {
  await call({ email: "upd@test.com" });
  const { json } = await call({
    action: "update",
    email: "upd@test.com",
    shortSummary: "3 viewed",
    minPrice: 400000,
    maxPrice: 900000.4,
    tags: ["vip"],
    note: "CHG_FAVORITES:{}",
  });
  assert.equal(json.action, "update");
  const lead = await leadByEmail("upd@test.com");
  assert.equal(lead.short_summary, "3 viewed");
  assert.equal(lead.min_price, 400000);
  assert.equal(lead.max_price, 900000);
  assert.deepEqual(lead.tags, ["vip"]);
  assert.ok(!(await activityTypes(lead.id)).includes("note"));

  await call({ action: "update", email: "upd@test.com", note: "Real note" });
  assert.ok((await activityTypes(lead.id)).includes("note"));
});

test("tracking updates activity and lead counters", async () => {
  await call({ email: "track@test.com" });
  await call({ action: "siteVisit", email: "track@test.com", url: "https://x/search.html" });
  await call({ action: "propertyView", email: "track@test.com", mlsNumber: "7080336", partnerLink: "https://x/property.html?id=247121411" });
  await call({ action: "addNote", email: "track@test.com", message: "hello" });

  const lead = await leadByEmail("track@test.com");
  assert.equal(lead.total_page_views, 1);
  assert.equal(lead.total_listing_views, 1);
  assert.ok(lead.last_active_at);
  const [view] = await rows("SELECT * FROM activities WHERE lead_id = $1 AND type = 'listing_view'", [lead.id]);
  assert.equal(view.property_id, "247121411");
  assert.equal(view.mls_number, "7080336");
});

test("tracking creates a row for registered visitors from before the migration", async () => {
  const { json } = await call({ action: "siteVisit", email: "old-user@test.com", url: "https://x/" });
  assert.equal(json.crm, "supabase");
  assert.ok(await leadByEmail("old-user@test.com"));
});

test("favorites: save, double save, list, remove, double remove", async () => {
  const save = { action: "saveListing", email: "fav@test.com", mlsNumber: "7080336", propertyId: "247121411", price: 650000, city: "Mesa", address: "1 Main St" };
  await call(save);
  await call(save);
  await call({ ...save, mlsNumber: "2", propertyId: "2", price: 0 });

  const lead = await leadByEmail("fav@test.com");
  assert.equal(lead.total_favorites, 2);

  const { json } = await call({ action: "getLead", email: "fav@test.com" });
  assert.deepEqual(Object.keys(json.data.favorites).sort(), ["2", "247121411"]);
  assert.equal(json.data.favorites["247121411"].mlsNumber, "7080336");
  assert.equal(json.data.favorites["247121411"].price, 650000);
  assert.equal(json.data.favorites["2"].mlsNumber, "");

  await call({ action: "removeListing", email: "fav@test.com", mlsNumber: "7080336", propertyId: "247121411" });
  await call({ action: "removeListing", email: "fav@test.com", mlsNumber: "7080336", propertyId: "247121411" });
  assert.equal((await leadByEmail("fav@test.com")).total_favorites, 1);

  const types = await activityTypes(lead.id);
  assert.equal(types.filter((t) => t === "favorite_add").length, 2);
  assert.equal(types.filter((t) => t === "favorite_remove").length, 1);
});

test("getLead exposes only the name and favorites", async () => {
  await db.exec(`INSERT INTO leads (email, first_name, phone, password_hash, tags) VALUES ('private@test.com', 'Pri', '480', 'secret', '{vip}')`);
  const { json } = await call({ action: "getLead", email: "private@test.com" });
  assert.deepEqual(Object.keys(json.data).sort(), ["favorites", "firstName", "lastName"]);
  assert.ok(!JSON.stringify(json).includes("secret"));
});

test("getLead for an unknown email returns null data and creates nothing", async () => {
  const { json } = await call({ action: "getLead", email: "nobody@test.com" });
  assert.equal(json.data, null);
  assert.equal(await leadByEmail("nobody@test.com"), undefined);
});

test("a database failure keeps the old 200 fallback and hides the error", async () => {
  const brokenDb = { query: async () => { throw new Error("connection refused at 10.0.0.1"); } };
  const broken = loadLeadHandler(brokenDb);
  const res = await broken({ httpMethod: "POST", body: JSON.stringify({ email: "x@test.com" }) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { success: true, crm: "fallback" });
});
