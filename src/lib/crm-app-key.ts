import { z } from "zod";

export function normalizeCrmAppKey(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  const prefixed = /^[a-z]/.test(slug) ? slug : `app-${slug}`;
  return prefixed.slice(0, 40).replace(/-+$/g, "");
}

export const crmAppKeySchema = z.string()
  .transform(normalizeCrmAppKey)
  .pipe(z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, "Application key must contain at least two letters, numbers, or hyphens."));
