// OpenAPI 3.0 description of the public API. Served at /openapi.json; the staging DAST
// (OWASP ZAP API scan) imports it to generate requests against every operation.
import { MAX_ITEMS, MAX_QUANTITY } from "./validate.js";

const error = { type: "object", properties: { detail: {} }, required: ["detail"] };
const id = (name, pattern, example) => ({
  name, in: "path", required: true, schema: { type: "string", pattern }, example,
});

const item = {
  type: "object",
  additionalProperties: false,
  required: ["sku", "quantity", "unit_price"],
  properties: {
    sku: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{2,31}$", example: "SKU-1001" },
    quantity: { type: "integer", minimum: 1, maximum: MAX_QUANTITY, example: 2 },
    unit_price: { type: "string", pattern: "^(0|[1-9][0-9]{0,5})\\.[0-9]{2}$", example: "12.50" },
  },
};

const orderIn = {
  type: "object",
  additionalProperties: false,
  required: ["customer_id", "currency", "items"],
  properties: {
    customer_id: { type: "string", pattern: "^c_[a-z0-9]{6,32}$", example: "c_acme001" },
    currency: { type: "string", enum: ["USD", "EUR", "GBP"], example: "USD" },
    payment_id: { type: "string", pattern: "^pay_[0-9a-f]{32}$", example: "pay_0123456789abcdef0123456789abcdef" },
    items: { type: "array", minItems: 1, maxItems: MAX_ITEMS, items: item },
  },
};

const order = {
  type: "object",
  required: ["id", "customer_id", "currency", "items", "total", "status", "created_at"],
  properties: {
    ...orderIn.properties,
    id: { type: "string", pattern: "^ord_[0-9a-f]{32}$" },
    payment_id: { type: "string", nullable: true },
    total: { type: "string", example: "25.00" },
    status: { type: "string", enum: ["pending", "cancelled"] },
    created_at: { type: "string", format: "date-time" },
  },
};

const json = (schema) => ({ "application/json": { schema } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const errors = {
  404: { description: "Not found", content: json(ref("Error")) },
  422: { description: "Validation error", content: json(ref("Error")) },
};

export function openapi(version) {
  return {
    openapi: "3.0.3",
    info: { title: "orders-api", version },
    paths: {
      "/orders": {
        post: {
          operationId: "createOrder",
          requestBody: { required: true, content: json(ref("OrderIn")) },
          responses: {
            201: { description: "Created", content: json(ref("Order")) },
            413: { description: "Body too large", content: json(ref("Error")) },
            415: { description: "Not JSON", content: json(ref("Error")) },
            422: errors[422],
          },
        },
        get: {
          operationId: "listOrders",
          parameters: [{ name: "customer_id", in: "query", required: true, schema: orderIn.properties.customer_id }],
          responses: { 200: { description: "OK", content: json({ type: "array", items: ref("Order") }) }, 422: errors[422] },
        },
      },
      "/orders/{order_id}": {
        get: {
          operationId: "getOrder",
          parameters: [id("order_id", "^ord_[0-9a-f]{32}$", "ord_0123456789abcdef0123456789abcdef")],
          responses: { 200: { description: "OK", content: json(ref("Order")) }, 404: errors[404] },
        },
      },
      "/orders/{order_id}/cancel": {
        post: {
          operationId: "cancelOrder",
          parameters: [id("order_id", "^ord_[0-9a-f]{32}$", "ord_0123456789abcdef0123456789abcdef")],
          responses: {
            200: { description: "Cancelled", content: json(ref("Order")) },
            404: errors[404],
            409: { description: "Not cancellable", content: json(ref("Error")) },
          },
        },
      },
    },
    components: { schemas: { OrderIn: orderIn, Order: order, Error: error } },
  };
}
