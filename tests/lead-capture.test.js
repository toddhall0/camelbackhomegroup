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
async function openPage(local) {
  const sent = [];
  const listeners = {};
  const pending = new Set();
  const element = () => ({ style: {}, classList: { add() {}, remove() {} }, textContent: "", appendChild() {} });

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
    setTimeout: () => 0,
    document: {
      readyState: "complete",
      head: element(),
      createElement: element,
      getElementById: () => null,
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
  return { window, sent, settle, favorites: () => Object.keys(window.chgGetFavorites()).sort() };
}

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
