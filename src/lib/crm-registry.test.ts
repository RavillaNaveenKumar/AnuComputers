import { describe, expect, it } from "vitest";
import { formatCrmAutoNumber } from "./crm-auto-number";
import { immutableCrmFieldName } from "./crm-field-metadata";
import { crmSystemFields, hasStandardRecordStore, standardCrmApps, standardCrmDisplayFields, standardCrmObjects, standardCrmRelationships } from "./crm-registry";

describe("CRM standard metadata registry", () => {
  it("registers the requested Sales, Service, and Common objects without Marketing", () => {
    const apiNames = new Set(standardCrmObjects.map((object) => object.apiName));
    for (const apiName of [
      "Account", "Contact", "Lead", "Opportunity", "Product", "PriceBook", "Quote", "QuoteLineItem",
      "Order", "OrderItem", "Task", "Event", "Case", "CaseComment", "KnowledgeArticle",
      "ServiceContract", "WorkOrder", "ServiceAppointment",
    ]) expect(apiNames.has(apiName), `${apiName} is in the standard registry`).toBe(true);
    expect(standardCrmObjects.every((object) => object.module !== ("MARKETING" as string))).toBe(true);
    expect(apiNames.size).toBe(standardCrmObjects.length);
  });

  it("seeds independent Sales and Service applications with shared Accounts, Contacts, Tasks, and Events", () => {
    const sales = standardCrmApps.find((app) => app.key === "sales");
    const service = standardCrmApps.find((app) => app.key === "service");
    expect(sales?.objects).toEqual(["Account", "Contact", "Lead", "Opportunity", "Product", "PriceBook", "Quote", "QuoteLineItem", "Order", "OrderItem", "Task", "Event"]);
    expect(service?.objects).toEqual(["Account", "Contact", "Case", "CaseComment", "KnowledgeArticle", "ServiceContract", "WorkOrder", "ServiceAppointment", "Task", "Event"]);
    expect(sales?.objects.filter((apiName) => service?.objects.includes(apiName))).toEqual(["Account", "Contact", "Task", "Event"]);
  });

  it("defines the baseline sales and service object relationships", () => {
    const pairs = new Set(standardCrmRelationships.map(([source, target]) => `${source}->${target}`));
    for (const pair of [
      "Account->Contact", "Account->Opportunity", "Account->Case", "Account->Order",
      "Contact->Case", "Lead->Opportunity", "Opportunity->Quote", "Quote->QuoteLineItem",
      "Product->PriceBookEntry", "Order->OrderItem", "Case->CaseComment", "Case->WorkOrder",
      "WorkOrder->ServiceAppointment",
    ]) expect(pairs.has(pair), `${pair} relationship exists`).toBe(true);
  });

  it("uses registry records only for standard objects without an existing business data model", () => {
    expect(hasStandardRecordStore("Account")).toBe(true);
    expect(hasStandardRecordStore("CaseComment")).toBe(true);
    expect(hasStandardRecordStore("Opportunity")).toBe(false);
    expect(hasStandardRecordStore("ServiceAppointment")).toBe(false);
  });

  it("keeps native-backed standard field metadata aligned with the application models", () => {
    const fields = (apiName: string) => new Map(standardCrmObjects.find((object) => object.apiName === apiName)?.fields.map((field) => [field.apiName, field] as const) || []);
    expect([...fields("Lead").keys()]).toEqual(expect.arrayContaining([
      "Name", "Reference", "Email", "Phone", "Status", "Source", "Interest",
      "EstimatedQuantity", "NextFollowUpAt", "Notes", "ActivityKind", "ActivityNote", "AccountId", "AssigneeId",
    ]));
    expect([...fields("Account").keys()]).toContain("AddressDetails");
    expect([...fields("Order").keys()]).toContain("ShippingAddress");
    expect([...fields("Product").keys()]).toEqual(expect.arrayContaining([
      "Name", "ProductCode", "Brand", "Model", "ManufacturerPart", "Description", "Price",
      "TrackingType", "WarrantyMonths", "Active", "CategoryId",
    ]));
    expect(fields("QuoteLineItem").get("Quantity")?.dataType).toBe("NUMBER");
    expect(fields("OrderItem").get("Quantity")?.dataType).toBe("NUMBER");
    expect([...fields("Case").keys()]).toEqual(expect.arrayContaining([
      "CaseNumber", "AccountId", "OrderId", "Subject", "Description", "Status", "Priority", "AssigneeId",
    ]));
    expect([...fields("Contact").keys()]).toEqual(expect.arrayContaining(["Name", "FirstName", "LastName", "AccountId"]));
    expect(standardCrmObjects.find(({ apiName }) => apiName === "Contact")?.fields.find(({ apiName }) => apiName === "Name"))
      .toMatchObject({ isNameField: true, readOnly: true });
  });

  it("defines immutable system fields and object-specific display fields centrally", () => {
    expect(crmSystemFields.map(({ apiName }) => apiName)).toEqual([
      "Id", "CreatedById", "CreatedDate", "LastModifiedById", "LastModifiedDate", "OwnerId", "SystemModstamp",
    ]);
    expect(crmSystemFields.find(({ apiName }) => apiName === "CreatedById")).toMatchObject({
      dataType: "LOOKUP",
      lookupTargetApiName: "User",
      required: true,
    });
    expect(standardCrmDisplayFields.Contact).toBe("Name");
    expect(standardCrmDisplayFields.Case).toBe("CaseNumber");
    expect(standardCrmDisplayFields.QuoteLineItem).toBe("Description");
  });

  it("formats auto numbers without truncating values larger than the minimum width", () => {
    expect(formatCrmAutoNumber("7", "AST-", "-X", 4)).toBe("AST-0007-X");
    expect(formatCrmAutoNumber("12345", "", "", 3)).toBe("12345");
  });

  it("rejects submitted system and auto-number fields while allowing text Name values", () => {
    const fields = [
      { apiName: "Id", origin: "SYSTEM" as const, readOnly: true, dataType: "ID" },
      { apiName: "Name", origin: "STANDARD" as const, readOnly: false, dataType: "TEXT" },
      { apiName: "Sequence", origin: "CUSTOM" as const, readOnly: true, dataType: "AUTO_NUMBER" },
    ];
    expect(immutableCrmFieldName({ Id: "client-id" }, fields)).toBe("Id");
    expect(immutableCrmFieldName({ Sequence: "client-number" }, fields)).toBe("Sequence");
    expect(immutableCrmFieldName({ Name: "Entered name" }, fields)).toBeUndefined();
  });
});
