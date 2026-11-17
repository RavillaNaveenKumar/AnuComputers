import { NextResponse } from "next/server";
import { z } from "zod";
import { createPreviewSession, isPreviewMode, previewCredentialsMatch, PREVIEW_COOKIE, previewSessionMaxAge } from "@/lib/preview-mode";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  if (!isPreviewMode()) return NextResponse.json({ error: "Preview login is disabled." }, { status: 404 });
  const input = credentialsSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  if (!process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Set the local preview email and password in .env." }, { status: 503 });
  }
  if (!previewCredentialsMatch(input.data.email, input.data.password)) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(PREVIEW_COOKIE, createPreviewSession(input.data.email.trim().toLowerCase()), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: previewSessionMaxAge,
  });
  return response;
}
