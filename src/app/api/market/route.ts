import { NextResponse } from "next/server";
import { getMarket } from "@/server/market";
import { guard, errorResponse } from "@/server/http";
import { quoteBook } from "@/lib/pricing";
export const maxDuration = 300;
export async function GET(req: Request) {
  try {
    guard(req);
    const m = await getMarket(
      new URL(req.url).searchParams.get("auctions") !== "false",
    );
    return NextResponse.json({
      ...m,
      books: undefined,
      recombPrice: quoteBook(m.books.RECOMBOBULATOR_3000, 1),
      prices: Object.fromEntries(
        m.offers
          .map((o) => [`${o.itemId}:${o.rarity}:${o.recomb}`, o])
          .sort(
            (a, b) =>
              (b[1] as { price: number }).price -
              (a[1] as { price: number }).price,
          ),
      ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
