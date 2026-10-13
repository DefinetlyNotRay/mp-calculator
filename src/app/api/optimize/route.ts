import { NextResponse } from "next/server";
import { z } from "zod";
import { ownedSchema, settingsSchema } from "@/lib/models";
import { optimize } from "@/lib/optimizer";
import { catalog, recipes, coverage } from "@/server/catalog";
import { getItems, getMarket } from "@/server/market";
import { guard, errorResponse } from "@/server/http";
export const maxDuration = 300;
const schema = z.object({
  owned: z.array(ownedSchema).max(1000),
  settings: settingsSchema,
  manual: z
    .record(z.string().max(100), z.number().nonnegative().max(1e12))
    .default({}),
});
export async function POST(req: Request) {
  try {
    guard(req);
    if (Number(req.headers.get("content-length") ?? 0) > 250000)
      return NextResponse.json(
        { error: "Input is too large." },
        { status: 413 },
      );
    const body = schema.parse(await req.json());
    if (body.owned.filter((o) => o.active).length > body.settings.capacity)
      return NextResponse.json(
        {
          error:
            "Your active collection exceeds the configured bag capacity. Confirm capacity or deactivate items.",
        },
        { status: 400 },
      );
    body.settings.maxStates = Math.min(
      body.settings.maxStates,
      Math.max(100, Number(process.env.MAX_OPTIMIZER_STATES ?? 8000)),
    );
    const [items, market] = await Promise.all([
      getItems()
        .then((x) => x.value)
        .catch(() => catalog),
      getMarket(body.settings.auction),
    ]);
    const invalid = body.owned.filter((o) => !items.some((i) => i.id === o.id));
    if (invalid.length)
      return NextResponse.json(
        { error: "Some owned item IDs are unknown." },
        { status: 400 },
      );
    const plans = optimize(
      items,
      body.owned,
      recipes,
      market,
      body.settings,
      body.manual,
    );
    return NextResponse.json({
      plans,
      coverage,
      market: {
        bazaarUpdatedAt: market.bazaarUpdatedAt,
        auctionsUpdatedAt: market.auctionsUpdatedAt,
        stale: market.stale,
      },
      limitations: [
        "Exact status applies only to available modeled acquisition paths, not every route in SkyBlock.",
        "Cross-family crafting recipes are excluded. Extra copies in repeated-accessory recipes are quoted as purchases; surplus owned copies need a manual estimate. Recombobulated predecessor crafting is excluded unless its carry-over rule has been verified.",
        "Resale is excluded without a guaranteed realizable offer. Soulbound accessories have no assumed resale value.",
      ],
    });
  } catch (e) {
    return errorResponse(e);
  }
}
