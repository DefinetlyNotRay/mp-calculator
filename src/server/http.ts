import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "./hypixel";
export function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: "Invalid input or upstream response.",
        details: error.issues.map((i) => i.path.join(".")),
      },
      { status: 400 },
    );
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: error.message },
      {
        status: error.status >= 400 && error.status < 600 ? error.status : 503,
        headers: error.retryAfter
          ? { "Retry-After": String(error.retryAfter) }
          : {},
      },
    );
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed." },
    { status: 503 },
  );
}
const requests = new Map<string, { start: number; count: number }>();
export function guard(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin && new URL(origin).host !== host)
    throw new ApiError("Cross-origin requests are not allowed.", 403);
  const id = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const now = Date.now();
  let bucket = requests.get(id);
  if (!bucket || now - bucket.start > 60000) {
    bucket = { start: now, count: 0 };
    requests.set(id, bucket);
  }
  if (++bucket.count > 30)
    throw new ApiError("Too many requests. Please wait a minute.", 429, 60);
  if (requests.size > 10000) requests.clear();
}
