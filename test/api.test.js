// Node's built-in test runner and fetch: no test dependencies to curate or patch.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { SECURITY_HEADERS, createApp } from "../src/app.js";

let server;
let base;
before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const GOOD = {
  customer_id: "c_acme001",
  currency: "USD",
  items: [
    { sku: "SKU-1001", quantity: 2, unit_price: "12.50" },
    { sku: "SKU-2002", quantity: 1, unit_price: "0.10" },
  ],
};
const post = (path, body, headers = { "content-type": "application/json" }) =>
  fetch(base + path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

test("health", async () => {
  const r = await fetch(`${base}/healthz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "ok" });
});

test("create, fetch and total is computed by the server", async () => {
  const created = await post("/orders", GOOD);
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.match(body.id, /^ord_[0-9a-f]{32}$/);
  assert.equal(body.status, "pending");
  assert.equal(body.total, "25.10"); // 2 x 12.50 + 0.10, in integer cents (no 25.099999)
  const fetched = await fetch(`${base}/orders/${body.id}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), body);
});

test("list is scoped to the customer", async () => {
  await post("/orders", { ...GOOD, customer_id: "c_other99" });
  const rows = await (await fetch(`${base}/orders?customer_id=c_acme001`)).json();
  assert.ok(rows.length > 0 && rows.every((o) => o.customer_id === "c_acme001"));
});

test("cancel only a pending order", async () => {
  const { id } = await (await post("/orders", GOOD)).json();
  const first = await post(`/orders/${id}/cancel`, "");
  assert.equal(first.status, 200);
  assert.equal((await first.json()).status, "cancelled");
  assert.equal((await post(`/orders/${id}/cancel`, "")).status, 409);
  assert.equal((await post(`/orders/ord_${"0".repeat(32)}/cancel`, "")).status, 404);
});

test("validation rejects bad input", async () => {
  const item = GOOD.items[0];
  const bad = [
    { ...GOOD, customer_id: "acme" },
    { ...GOOD, currency: "BTC" },
    { ...GOOD, items: [] },
    { ...GOOD, items: Array(51).fill(item) },
    { ...GOOD, items: [{ ...item, quantity: 0 }] },
    { ...GOOD, items: [{ ...item, quantity: 1.5 }] },
    { ...GOOD, items: [{ ...item, quantity: "2" }] },
    { ...GOOD, items: [{ ...item, unit_price: "-1.00" }] },
    { ...GOOD, items: [{ ...item, unit_price: "0.00" }] },
    { ...GOOD, items: [{ ...item, unit_price: "12.5" }] },
    { ...GOOD, items: [{ ...item, unit_price: 12.5 }] },
    { ...GOOD, items: [{ ...item, sku: "<script>" }] },
    { ...GOOD, payment_id: "pay_x" },
    [GOOD],
  ];
  for (const body of bad) assert.equal((await post("/orders", body)).status, 422, JSON.stringify(body).slice(0, 80));
});

test("mass assignment: status, total and unknown fields are rejected", async () => {
  for (const extra of [{ status: "shipped" }, { total: "0.01" }, { role: "admin" }]) {
    assert.equal((await post("/orders", { ...GOOD, ...extra })).status, 422);
  }
  const r = await post("/orders", { ...GOOD, items: [{ ...GOOD.items[0], discount: "100" }] });
  assert.equal(r.status, 422);
});

test("prototype pollution payloads are rejected and do not pollute", async () => {
  const raw = '{"customer_id":"c_acme001","currency":"USD","items":[{"sku":"SKU-1","quantity":1,"unit_price":"1.00"}],"__proto__":{"polluted":true}}';
  assert.equal((await post("/orders", raw)).status, 422);
  assert.equal({}.polluted, undefined);
});

test("injection-style ids and queries find nothing", async () => {
  assert.equal((await fetch(`${base}/orders/' OR '1'='1`)).status, 404);
  assert.equal((await fetch(`${base}/orders/__proto__`)).status, 404);
  assert.equal((await fetch(`${base}/orders?customer_id=c_acme001' OR '1'='1`)).status, 422);
  assert.equal((await fetch(`${base}/orders?customer_id=c_acme001&customer_id=c_other99`)).status, 422);
  assert.equal((await fetch(`${base}/orders?customer_id[$ne]=x`)).status, 422);
});

test("transport rules: JSON only, malformed JSON, 16 KB limit", async () => {
  assert.equal((await post("/orders", "customer_id=c_acme001", { "content-type": "application/x-www-form-urlencoded" })).status, 415);
  assert.equal((await post("/orders", "{not json")).status, 400);
  const big = { ...GOOD, items: [{ ...GOOD.items[0], sku: "A".repeat(20_000) }] };
  assert.equal((await post("/orders", big)).status, 413);
});

test("errors are JSON without stack traces", async () => {
  const r = await post("/orders", "{not json");
  const text = await r.text();
  assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
  assert.ok(!/at .+\.js:\d+/.test(text), "stack trace leaked");
});

test("security headers, no banner, schema served", async () => {
  const r = await fetch(`${base}/healthz`);
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers.get(header), value);
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.equal((await fetch(`${base}/docs`)).status, 404);
  const spec = await (await fetch(`${base}/openapi.json`)).json(); // used by the DAST API scan
  assert.equal(spec.info.title, "orders-api");
});
