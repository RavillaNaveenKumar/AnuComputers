import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GemNava CRM",
  description: "CRM workspace for sales, service, and customer operations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
