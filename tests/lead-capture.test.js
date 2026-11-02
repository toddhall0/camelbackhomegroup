// Runs the real lead-capture.js in a minimal fake browser, wired to the real handler
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDatabase, loadLeadHandler } = require("./helpers");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "lead-capture.js"), "utf8");
const USER = { email: "shopper@test.com", firstName: "Shopper" };

let db, handler;

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

// Loads the page and waits for the fire-and-forget CRM calls to finish
async function openPage(local, { runTimers = false } = {}) {
  const sent = [];
  const listeners = {};
  const pending = new Set();
  const element = () => {
    const handlers = {};
    return {
      style: {},
      classList: { add() {}, remove() {} },
      textContent: "",
      value: "",
      appendChild() {},
      remove() {},
      querySelectorAll: () => [],
      focus() {},
      addEventListener: (type, fn) => (handlers[type] = fn),
      fire: (type) => handlers[type] && handlers[type](),
    };
  };
  const elements = new Proxy({}, { get: (made, id) => (made[id] ||= element()) });

  const window = {
    addEventListener: (type, fn) => (listeners[type] = fn),
    localStorage: local,
    sessionStorage: storage(),
  };
  const context = {
    window,
    localStorage: local,
    sessionStorage: window.sessionStorage,
    location: { pathname: "/search.html", href: "https://chg.test/search.html", origin: "https://chg.test" },
    console: { log() {}, warn() {} },
    setTimeout: (fn) => {
      if (runTimers) fn();
      return 0;
    },
    document: {
      readyState: "complete",
      head: element(),
      body: element(),
      createElement: element,
      getElementById: (id) => (runTimers ? elements[id] : null),
      querySelectorAll: () => [],
      addEventListener() {},
    },
    fetch: (url, init) => {
      const body = JSON.parse(init.body);
      sent.push(body);
      const request = handler({ httpMethod: "POST", body: init.body }).then((res) => ({ json: async () => JSON.parse(res.body) }));
      pending.add(request);
      return request;
    },
  };

  vm.runInNewContext(SCRIPT, context);
  listeners.load();

  const settle = async () => {
    for (let idle = 0; idle < 5; idle++) {
      if (pending.size) idle = 0;
      await Promise.allSettled([...pending]);
      pending.clear();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  await settle();
  return { window, sent, settle, elements, favorites: () => Object.keys(window.chgGetFavorites()).sort() };
}

// A returning visitor who hasn't signed up, so the popup opens
const visitor = (extra = {}) => {
  const items = { chg_stats: JSON.stringify({ pageViews: 5, listingClicks: 0, viewedListings: [], viewedPrices: [], viewedCities: {} }) };
  for (const [k, v] of Object.entries(extra)) items[`chg_${k}`] = JSON.stringify(v);
  return storage(items);
};

const popupLead = async (email) => (await db.query("SELECT * FROM leads WHERE email = $1", [email])).rows[0];

const browser = (extra = {}) => {
  const items = { chg_user: JSON.stringify(USER) };
  for (const [k, v] of Object.entries(extra)) items[`chg_${k}`] = JSON.stringify(v);
  return storage(items);
};

const serverFavorites = async () =>
  (await db.query("SELECT f.property_id FROM favorites f JOIN leads l ON l.id = f.lead_id WHERE l.email = $1 ORDER BY 1", [USER.email])).rows.map((r) => r.property_id);

before(async () => {
  db = await createDatabase();
  handler = loadLeadHandler(db);
});

test("favorites saved before the migration are pushed up once from this browser", async () => {
  const device = browser({ favorites: { 111: { price: 500000, city: "Mesa", address: "1 Main St", savedAt: "2026-01-01" } } });
  await openPage(device);
  assert.deepEqual(await serverFavorites(), ["111"]);
});

test("the heart button uses saveListing/removeListing and never the note field", async () => {
  const page = await openPage(browser({ favMigrated: true }));
  page.sent.length = 0;

  assert.equal(page.window.chgToggleFavorite("222", 750000, "Gilbert", "2 Oak Ave", "7080336"), true);
  await page.settle();
  assert.deepEqual(await serverFavorites(), ["111", "222"]);
  const [{ mls_number }] = (await db.query("SELECT mls_number FROM favorites WHERE property_id = '222'")).rows;
  assert.equal(mls_number, "7080336");

  assert.equal(page.window.chgToggleFavorite("222"), false);
  await page.settle();
  assert.deepEqual(await serverFavorites(), ["111"]);

  assert.deepEqual([...new Set(page.sent.map((d) => d.action))].sort(), ["removeListing", "saveListing", "update"]);
  assert.ok(!page.sent.some((d) => d.note));
});

test("a second device gets the favorites from Supabase", async () => {
  const page = await openPage(browser());
  assert.deepEqual(page.favorites(), ["111"]);
  assert.equal(page.window.chgGetUser().firstName, "Shopper");
});

test("a removal on one device does not come back from another", async () => {
  const stale = browser({ favMigrated: true, favorites: { 111: { price: 1 } } });
  const phone = await openPage(browser({ favMigrated: true }));
  phone.window.chgToggleFavorite("111");
  await phone.settle();

  const laptop = await openPage(stale);
  assert.deepEqual(laptop.favorites(), []);
  assert.deepEqual(await serverFavorites(), []);
});

test("anonymous browsing stays in the browser until the visitor is known", async () => {
  const local = storage();
  const page = await openPage(local);
  page.sent.length = 0;
  page.window.chgTrackSearch("Gilbert", { minBeds: 3 });
  page.window.chgTrackSearch("Gilbert", { minBeds: 3 });
  page.window.chgTrackPropertyView({ id: 777, mlsNumber: "7100959", price: 500000, city: "Mesa", address: "1 Main St" });
  page.window.chgTrackPropertyView({ id: 777, mlsNumber: "7100959", price: 500000, city: "Mesa", address: "1 Main St" });
  await page.settle();
  assert.equal(page.sent.length, 0);

  const pending = page.window.chgTakeBrowsing();
  assert.deepEqual(Array.from(pending, (e) => e.action), ["search", "propertyView"]);
  assert.ok(pending[0].at);
  assert.equal(page.window.chgTakeBrowsing().length, 0);
});

test("a known visitor's views and searches go straight to the CRM", async () => {
  const page = await openPage(browser({ favMigrated: true }));
  page.sent.length = 0;
  page.window.chgTrackSearch("Tempe", {});
  page.window.chgTrackPropertyView({ id: 888, mlsNumber: "1", price: 400000, city: "Tempe", address: "2 Oak" });
  await page.settle();
  assert.deepEqual(page.sent.map((d) => d.action), ["search", "propertyView", "update"]);
  const views = await db.query("SELECT a.property_address FROM activities a JOIN leads l ON l.id = a.lead_id WHERE l.email = $1 AND a.type = 'listing_view'", [USER.email]);
  assert.deepEqual(views.rows.map((r) => r.property_address), ["2 Oak"]);
});

test("a failed lookup keeps the local favorites", async () => {
  const realHandler = handler;
  const broken = async () => ({ statusCode: 200, body: JSON.stringify({ success: true, crm: "fallback" }) });
  handler = broken;
  try {
    const page = await openPage(browser({ favMigrated: true, favorites: { 333: { price: 1 } } }));
    assert.deepEqual(page.favorites(), ["333"]);
  } finally {
    handler = realHandler;
  }
});

test("popup: a name alone sends nothing", async () => {
  const page = await openPage(visitor(), { runTimers: true });
  page.sent.length = 0;
  page.elements.chgName.value = "Nia Vale";
  page.elements.chgN1.onclick();
  await page.settle();
  assert.deepEqual(page.sent, []);
});

test("popup: leaving the email field saves the lead once, with earlier browsing", async () => {
  const device = visitor({ pending: [{ action: "search", query: "mesa", at: new Date().toISOString() }] });
  const page = await openPage(device, { runTimers: true });
  page.sent.length = 0;
  page.elements.chgName.value = "Nia Vale";
  page.elements.chgN1.onclick();

  page.elements.chgEmail.value = "not-finished@";
  page.elements.chgEmail.fire("blur");
  await page.settle();
  assert.deepEqual(page.sent, []);

  page.elements.chgEmail.value = "nia@test.com";
  page.elements.chgEmail.fire("blur");
  page.elements.chgN2.onclick();
  await page.settle();

  assert.equal(page.sent.length, 1);
  const lead = await popupLead("nia@test.com");
  assert.equal(lead.first_name, "Nia");
  assert.equal(lead.source_detail, "Website Popup (partial - name+email)");
  const { rows } = await db.query("SELECT type FROM activities WHERE lead_id = $1 AND type = 'search'", [lead.id]);
  assert.equal(rows.length, 1);
});

test("popup: a partial visitor keeps being tracked on later pages, without being logged in", async () => {
  const device = visitor();
  const page = await openPage(device, { runTimers: true });
  page.elements.chgName.value = "Omar Reed";
  page.elements.chgN1.onclick();
  page.elements.chgEmail.value = "omar@test.com";
  page.elements.chgN2.onclick();
  await page.settle();

  const later = await openPage(device);
  later.sent.length = 0;
  later.window.chgTrackSearch("gilbert pool", {});
  await later.settle();

  assert.equal(device.getItem("chg_user"), null);
  assert.equal(later.sent[0].email, "omar@test.com");
  const lead = await popupLead("omar@test.com");
  const { rows } = await db.query("SELECT message FROM activities WHERE lead_id = $1 AND type = 'search'", [lead.id]);
  assert.equal(rows.length, 1);
});

test("popup: finishing sign-up clears the partial state and marks the lead complete", async () => {
  const device = visitor();
  const page = await openPage(device, { runTimers: true });
  page.elements.chgName.value = "Lena Fox";
  page.elements.chgN1.onclick();
  page.elements.chgEmail.value = "lena@test.com";
  page.elements.chgN2.onclick();
  page.elements.chgPhone.value = "480-555-0199";
  page.elements.chgSubmit.onclick();
  await page.settle();

  const lead = await popupLead("lena@test.com");
  assert.equal(lead.source_detail, "Website Registration Popup");
  assert.equal(lead.phone, "480-555-0199");
  assert.equal(JSON.parse(device.getItem("chg_user")).email, "lena@test.com");
  assert.equal(JSON.parse(device.getItem("chg_partialEmail")), "");
});
