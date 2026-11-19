// orders-api: a small order service onboarded to the Triorex paved road.
//
// Deliberately simple so the security controls around it are the point:
//   - strict, allow-list input validation; server-computed totals; integer-cent money
//   - JSON only, 16 KB body limit, no prototype-reachable storage
//   - security headers on every response, no X-Powered-By, no stack traces in errors
import express from "express";
import { openapi } from "./openapi.js";
import { Store } from "./store.js";
import { CUSTOMER_ID, ORDER_ID, ValidationError, parseOrder } from "./validate.js";

export const VERSION = "1.0.0";

export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
};

const fail = (res, status, detail) => res.status(status).json({ detail });

export function createApp({ store = new Store() } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("query parser", "simple"); // flat strings only: no nested objects from ?a[b]=c

  app.use((_req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true, type: "application/json" }));

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/openapi.json", (_req, res) => res.json(openapi(VERSION)));

  app.post("/orders", (req, res) => {
    if (!req.is("application/json")) return fail(res, 415, "Content-Type must be application/json");
    const order = parseOrder(req.body); // throws ValidationError -> 422
    return res.status(201).json(store.add(order));
  });

  app.get("/orders", (req, res) => {
    const customerId = req.query.customer_id;
    if (typeof customerId !== "string" || !CUSTOMER_ID.test(customerId)) {
      return fail(res, 422, [{ loc: "query.customer_id", msg: "required; c_ followed by 6-32 lowercase letters or digits" }]);
    }
    return res.json(store.byCustomer(customerId));
  });

  app.get("/orders/:id", (req, res) => {
    const order = ORDER_ID.test(req.params.id) ? store.get(req.params.id) : null;
    return order ? res.json(order) : fail(res, 404, "order not found");
  });

  app.post("/orders/:id/cancel", (req, res) => {
    const result = ORDER_ID.test(req.params.id) ? store.cancel(req.params.id) : null;
    if (result === null) return fail(res, 404, "order not found");
    if (result === false) return fail(res, 409, "only pending orders can be cancelled");
    return res.json(result);
  });

  app.use((_req, res) => fail(res, 404, "not found"));

  // Errors: known client errors keep their status; anything else is a generic 500 with no details.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ValidationError) return fail(res, 422, err.errors);
    if (err.type === "entity.too.large") return fail(res, 413, "request body too large");
    if (err.type === "entity.parse.failed") return fail(res, 400, "malformed JSON");
    if (err.status >= 400 && err.status < 500) return fail(res, err.status, "bad request");
    console.error(JSON.stringify({ level: "error", msg: "unhandled error", error: String(err?.message ?? err) }));
    return fail(res, 500, "internal error");
  });

  return app;
}
