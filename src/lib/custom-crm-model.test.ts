import { describe, expect, it } from "vitest";
import {
  isValidApiName,
  makeApiName,
  validateCustomRecord,
  type CustomField,
} from "./custom-crm-model";

describe("custom CRM object model", () => {
  it("generates stable API names and validates custom identifiers", () => {
    expect(makeApiName("Service Visit")).toBe("service_visit");
    expect(makeApiName("Warranty & Repair")).toBe("warranty_repair");
    expect(isValidApiName("service_visit")).toBe(true);
    expect(isValidApiName("Service Visit")).toBe(false);
  });

  it("validates required fields, numeric values, picklists, and lookup values", () => {
    const fields: CustomField[] = [
      { id: "name", label: "Name", apiName: "name", type: "TEXT", required: true, options: [] },
      { id: "fee", label: "Fee", apiName: "fee", type: "CURRENCY", required: true, options: [] },
      { id: "status", label: "Status", apiName: "status", type: "PICKLIST", required: true, options: ["Open", "Closed"] },
      { id: "customer", label: "Customer", apiName: "customer", type: "LOOKUP", required: true, options: [], relatedObjectId: "customer" },
    ];
    expect(validateCustomRecord(fields, {})).toBe("Name is required.");
    expect(validateCustomRecord(fields, { name: "Install", fee: "5", status: "Open", customer: "c1" })).toBe("Fee must be a valid number.");
    expect(validateCustomRecord(fields, { name: "Install", fee: 5, status: "Other", customer: "c1" })).toBe("Choose a valid option for Status.");
    expect(validateCustomRecord(fields, { name: "Install", fee: 5, status: "Open", customer: "c1" })).toBeNull();
  });

  it("requires a parent record for a master-detail relationship", () => {
    const fields: CustomField[] = [{
      id: "customer", label: "Customer", apiName: "customer", type: "LOOKUP",
      required: false, options: [], relatedObjectId: "standard:customers", relationshipKind: "MASTER_DETAIL",
    }];
    expect(validateCustomRecord(fields, { customer: null })).toBe("Customer is required.");
    expect(validateCustomRecord(fields, { customer: "customer-1" })).toBeNull();
  });
});
