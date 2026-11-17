export const money = (value: number | string | { toString(): string }) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value));

export function dateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
  }).format(new Date(value));
}
