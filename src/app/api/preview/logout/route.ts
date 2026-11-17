import { NextResponse } from "next/server";
import { isPreviewMode, PREVIEW_COOKIE } from "@/lib/preview-mode";

export async function POST() {
  if (!isPreviewMode()) return NextResponse.json({ error: "Preview login is disabled." }, { status: 404 });
  const response = NextResponse.json({ success: true });
  response.cookies.set(PREVIEW_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
