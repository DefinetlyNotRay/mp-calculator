import { NextResponse } from "next/server";
import { z } from "zod";
import { listProfiles, importProfile } from "@/server/profiles";
import { guard, errorResponse } from "@/server/http";
export async function GET(req: Request) {
  try {
    guard(req);
    const p = new URL(req.url).searchParams;
    const id = p.get("profile");
    if (id) {
      const uuid = z
        .string()
        .regex(/^[a-f\d]{32}$/i)
        .parse(p.get("uuid"));
      const profile = z
        .string()
        .regex(/^[a-f\d-]{32,36}$/i)
        .parse(id);
      return NextResponse.json(await importProfile(uuid, profile));
    }
    const name = z.string().min(1).max(36).parse(p.get("player"));
    return NextResponse.json(await listProfiles(name));
  } catch (e) {
    return errorResponse(e);
  }
}
