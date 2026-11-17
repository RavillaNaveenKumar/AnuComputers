import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.PREVIEW_MODE !== "true") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname === "/preview" ||
      pathname === "/api/preview/login" || pathname === "/api/preview/logout") {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "CRM data APIs are unavailable in local preview mode." }, { status: 404 });
  }

  const previewUrl = request.nextUrl.clone();
  previewUrl.pathname = "/preview";
  return NextResponse.rewrite(previewUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
