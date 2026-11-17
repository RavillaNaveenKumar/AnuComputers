import { describe, expect, it } from "vitest";
import { calculateQuote, validateDelivery } from "./business";

describe("quote calculations", () => {
  it("calculates quantities and discounts in paise", () => {
    expect(calculateQuote([
      { quantity: 10, unitPrice: 85000, discount: 500 },
      { quantity: 2, unitPrice: 145.5, discount: 0 },
    ], 1000)).toEqual({ subtotal: 849791, total: 848791 });
  });

  it("rejects discounts larger than the quote subtotal", () => {
    expect(() => calculateQuote([{ quantity: 1, unitPrice: 100, discount: 0 }], 101)).toThrow(/discount cannot exceed subtotal/);
  });
});

describe("delivery constraints", () => {
  it("allows delivery of six out of ten serialized laptops", () => {
    expect(() => validateDelivery(10, 6, 0, 6, "SERIAL", ["A1", "A2", "A3", "A4", "A5", "A6"])).not.toThrow();
  });

  it("does not allow delivering more than has been dispatched", () => {
    expect(() => validateDelivery(10, 6, 5, 2, "SERIAL", ["A6", "A7"])).toThrow(/cannot exceed dispatched/);
  });

  it("requires one serial per delivered serialized unit", () => {
    expect(() => validateDelivery(10, 6, 0, 2, "SERIAL", ["A1"])).toThrow(/one serial number/);
  });

  it("allows bulk quantity delivery without serials", () => {
    expect(() => validateDelivery(500, 300, 0, 300, "QUANTITY", [])).not.toThrow();
  });
});
