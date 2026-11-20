// Strict input validation for orders-api. Every field is allow-listed: unknown fields are rejected
// (no mass assignment of status or total), types are checked exactly, and money never touches floats.

export const CUSTOMER_ID = /^c_[a-z0-9]{6,32}$/;
export const ORDER_ID = /^ord_[0-9a-f]{32}$/;
export const PAYMENT_ID = /^pay_[0-9a-f]{32}$/; // issued by payments-api
const SKU = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const PRICE = /^(0|[1-9][0-9]{0,5})\.[0-9]{2}$/; // "12.50": always two decimals, at most 999999.99
export const CURRENCIES = ["USD", "EUR", "GBP"];
export const MAX_ITEMS = 50;
export const MAX_QUANTITY = 100;
const MAX_UNIT_CENTS = 10_000_000; // 100000.00

export class ValidationError extends Error {
  constructor(errors) {
    super("validation failed");
    this.errors = errors;
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function onlyKeys(obj, allowed, where, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push({ loc: `${where}.${key}`, msg: "unknown field" });
  }
}

export function toCents(price) {
  const [whole, frac] = price.split(".");
  return Number(whole) * 100 + Number(frac);
}

export function formatCents(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Validate a create-order body. Returns a clean object built only from known fields. */
export function parseOrder(body) {
  const errors = [];
  if (!isPlainObject(body)) throw new ValidationError([{ loc: "body", msg: "expected a JSON object" }]);
  onlyKeys(body, ["customer_id", "currency", "items", "payment_id"], "body", errors);

  const { customer_id, currency, items, payment_id } = body;
  if (typeof customer_id !== "string" || !CUSTOMER_ID.test(customer_id)) {
    errors.push({ loc: "body.customer_id", msg: "must match c_ followed by 6-32 lowercase letters or digits" });
  }
  if (!CURRENCIES.includes(currency)) {
    errors.push({ loc: "body.currency", msg: `must be one of ${CURRENCIES.join(", ")}` });
  }
  if (payment_id !== undefined && (typeof payment_id !== "string" || !PAYMENT_ID.test(payment_id))) {
    errors.push({ loc: "body.payment_id", msg: "must be a payments-api id (pay_ + 32 hex)" });
  }

  const clean = [];
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    errors.push({ loc: "body.items", msg: `must be a list of 1-${MAX_ITEMS} items` });
  } else {
    items.forEach((item, i) => {
      const at = `body.items[${i}]`;
      if (!isPlainObject(item)) {
        errors.push({ loc: at, msg: "expected an object" });
        return;
      }
      onlyKeys(item, ["sku", "quantity", "unit_price"], at, errors);
      const { sku, quantity, unit_price } = item;
      if (typeof sku !== "string" || !SKU.test(sku)) errors.push({ loc: `${at}.sku`, msg: "invalid SKU" });
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        errors.push({ loc: `${at}.quantity`, msg: `must be an integer from 1 to ${MAX_QUANTITY}` });
      }
      const priceOk = typeof unit_price === "string" && PRICE.test(unit_price);
      const cents = priceOk ? toCents(unit_price) : 0;
      if (!priceOk || cents < 1 || cents > MAX_UNIT_CENTS) {
        errors.push({ loc: `${at}.unit_price`, msg: 'must be a decimal string like "12.50", from 0.01 to 100000.00' });
      }
      clean.push({ sku, quantity, unit_price, cents });
    });
  }

  if (errors.length) throw new ValidationError(errors);
  return { customer_id, currency, payment_id: payment_id ?? null, items: clean };
}
