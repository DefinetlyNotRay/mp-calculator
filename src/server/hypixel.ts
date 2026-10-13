import "server-only";
import { z } from "zod";
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 503,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
let blockedUntil = 0;
const envelope = z
  .object({ success: z.boolean(), cause: z.string().optional() })
  .passthrough();
export async function hypixel(
  path: string,
  authenticated = false,
): Promise<Record<string, unknown>> {
  if (Date.now() < blockedUntil)
    throw new ApiError(
      "Hypixel rate limit reached. Please wait before refreshing.",
      429,
      Math.ceil((blockedUntil - Date.now()) / 1000),
    );
  const key = process.env.HYPIXEL_API_KEY;
  if (authenticated && !key)
    throw new ApiError(
      "Player import requires a server-side Hypixel API key. Manual mode is available.",
      503,
    );
  let response: Response;
  try {
    response = await fetch(`https://api.hypixel.net${path}`, {
      headers: authenticated ? { "API-Key": key! } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError("Hypixel could not be reached. Please try again later.");
  }
  const reset = Number(response.headers.get("ratelimit-reset") ?? 60);
  if (
    response.status === 429 ||
    response.headers.get("ratelimit-remaining") === "0"
  )
    blockedUntil =
      Date.now() +
      Math.max(reset, Number(response.headers.get("retry-after") ?? 0), 1) *
        1000;
  if (!response.ok)
    throw new ApiError(
      response.status === 403
        ? "Hypixel rejected the API key (403). Check its validity in the developer dashboard."
        : response.status === 429
          ? "Hypixel is rate limiting requests."
          : `Hypixel data unavailable (${response.status}).`,
      response.status,
      reset,
    );
  const body = envelope.safeParse(await response.json());
  if (!body.success)
    throw new ApiError("Hypixel returned an unexpected response schema.");
  if (!body.data.success)
    throw new ApiError(body.data.cause ?? "Hypixel reported unavailable data.");
  return body.data;
}
export async function resolvePlayer(
  input: string,
): Promise<{ uuid: string; name: string }> {
  const compact = input.replace(/-/g, "");
  if (/^[a-f\d]{32}$/i.test(compact))
    return { uuid: compact.toLowerCase(), name: input };
  if (!/^\w{1,16}$/.test(input))
    throw new ApiError("Enter a Minecraft username or a valid UUID.", 400);
  const r = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(input)}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!r.ok)
    throw new ApiError(
      "Minecraft username was not found or lookup is unavailable.",
      404,
    );
  const d = z
    .object({ id: z.string().regex(/^[a-f\d]{32}$/i), name: z.string() })
    .parse(await r.json());
  return { uuid: d.id, name: d.name };
}
