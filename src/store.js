// In-memory order store. The container runs with a read-only root filesystem, so nothing is
// written to disk. A Map (not a plain object) means user-supplied ids can never reach the prototype.
import { randomBytes } from "node:crypto";
import { formatCents } from "./validate.js";

export class Store {
  #orders = new Map();

  add(order) {
    const totalCents = order.items.reduce((sum, i) => sum + i.cents * i.quantity, 0);
    const record = {
      id: `ord_${randomBytes(16).toString("hex")}`,
      customer_id: order.customer_id,
      currency: order.currency,
      payment_id: order.payment_id,
      items: order.items.map(({ sku, quantity, unit_price }) => ({ sku, quantity, unit_price })),
      total: formatCents(totalCents), // computed here; a client-sent total is rejected as unknown
      status: "pending",
      created_at: new Date().toISOString(),
    };
    this.#orders.set(record.id, record);
    return structuredClone(record);
  }

  get(id) {
    const order = this.#orders.get(id);
    return order ? structuredClone(order) : null;
  }

  byCustomer(customerId) {
    return [...this.#orders.values()].filter((o) => o.customer_id === customerId).map((o) => structuredClone(o));
  }

  /** Cancel a pending order. Returns the order, null if missing, or false if it can no longer be cancelled. */
  cancel(id) {
    const order = this.#orders.get(id);
    if (!order) return null;
    if (order.status !== "pending") return false;
    order.status = "cancelled";
    return structuredClone(order);
  }
}
