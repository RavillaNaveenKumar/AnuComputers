export type QuoteLineInput = {
  quantity: number;
  unitPrice: number;
  discount: number;
};

export function calculateQuote(lines: QuoteLineInput[], overallDiscount: number) {
  if (!lines.length || !Number.isFinite(overallDiscount) || overallDiscount < 0) {
    throw new Error("Quote must contain items and valid discounts.");
  }
  const toPaise = (value: number) => Math.round(value * 100);
  const subtotalPaise = lines.reduce((sum, line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 ||
        !Number.isFinite(line.unitPrice) || line.unitPrice < 0 ||
        !Number.isFinite(line.discount) || line.discount < 0) {
      throw new Error("Quote line contains invalid quantity, price, or discount.");
    }
    const gross = line.quantity * toPaise(line.unitPrice);
    const discount = toPaise(line.discount);
    if (discount > gross) throw new Error("Line discount cannot exceed its line total.");
    return sum + gross - discount;
  }, 0);
  const discountPaise = toPaise(overallDiscount);
  if (discountPaise > subtotalPaise) throw new Error("Quote discount cannot exceed subtotal.");
  return { subtotal: subtotalPaise / 100, total: (subtotalPaise - discountPaise) / 100 };
}

export function validateDelivery(
  ordered: number,
  dispatched: number,
  previouslyDelivered: number,
  deliveringNow: number,
  trackingType: "SERIAL" | "QUANTITY",
  serials: string[],
) {
  if (!Number.isInteger(deliveringNow) || deliveringNow < 1 ||
      previouslyDelivered + deliveringNow > dispatched || dispatched > ordered) {
    throw new Error("Delivery quantity must be positive and cannot exceed dispatched quantity.");
  }
  if (trackingType === "SERIAL" && serials.length !== deliveringNow) {
    throw new Error("Provide one serial number for each serialized unit being delivered.");
  }
  if (trackingType === "QUANTITY" && serials.length) {
    throw new Error("Quantity-tracked items do not accept per-unit serial numbers.");
  }
}
