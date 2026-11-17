import { describe, expect, it } from "vitest";
import { parseCrmCsv } from "./crm-csv";

describe("CRM CSV parser", () => {
  it("parses escaped quotes, commas, and newlines in quoted cells", () => {
    expect(parseCrmCsv('\uFEFFName,Notes\r\n"Acme, Inc.","Line one\nShe said ""yes"""'))
      .toEqual([["Name", "Notes"], ["Acme, Inc.", "Line one\nShe said \"yes\""]]);
  });

  it("rejects unclosed quoted values", () => {
    expect(() => parseCrmCsv('Name,Notes\nAcme,"unfinished')).toThrow("unterminated quoted value");
  });
});
