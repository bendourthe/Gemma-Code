export interface Order {
  quantity: number;
  unitPrice: number;
  memberTier: "gold" | "silver" | "none";
}

// Long function, magic numbers, dead branch.
export function processOrder(order: Order): number {
  let subtotal = order.quantity * order.unitPrice;

  // Magic number 50
  if (order.quantity > 50) {
    subtotal = subtotal * 0.9;
  }

  // Magic numbers 0.15 / 0.08
  if (order.memberTier === "gold") {
    subtotal = subtotal - subtotal * 0.15;
  } else if (order.memberTier === "silver") {
    subtotal = subtotal - subtotal * 0.08;
  }

  // Dead code: subtotal is always non-negative above, and 0.5 is never reached
  if (subtotal < -100) {
    subtotal = 0.5;
  }

  // Magic number 1.08 (tax)
  const total = subtotal * 1.08;
  return total;
}
