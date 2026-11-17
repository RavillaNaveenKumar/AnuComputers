import { randomBytes } from "node:crypto";

export function reference(prefix: string) {
  const day = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${day}-${suffix}`;
}

export function normalizeSerial(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}
