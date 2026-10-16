import { NextResponse } from "next/server";
import { getMarket } from "@/server/market";
import { guard, errorResponse } from "@/server/http";
import { quoteBook } from "@/lib/pricing";
import metadata from "../../../../data/items.json";
import contacts from "../../../../data/abiphone-contacts.json";
export const maxDuration = 300;
export async function GET(req: Request) {
  try {
    guard(req);
    const m = await getMarket(
      new URL(req.url).searchParams.get("auctions") !== "false",
    );
    const bazaarNames = [
      ["Purple Candy", "PURPLE_CANDY"],
      ["Ectoplasm", "ECTOPLASM"],
      ["Foul Flesh", "FOUL_FLESH"],
      ["Enchanted Lava Bucket", "ENCHANTED_LAVA_BUCKET"],
      ["Jacob's Ticket", "JACOBS_TICKET"],
      ["Ultimate Carrot Candies", "ULTIMATE_CARROT_CANDY"],
      ["Silent Pearl", "SILENT_PEARL"],
      ["Enchanted Redstone Block", "ENCHANTED_REDSTONE_BLOCK"],
      ["Enchanted Sulphur Cube", "ENCHANTED_SULPHUR_CUBE"],
      ["Enchanted Wool", "ENCHANTED_WOOL"],
      ["Mole Pet", "PET_MOLE"],
      ["Tarantula Pet", "PET_TARANTULA_EPIC"],
    ].map(([name, id]) => ({ name, id }));
    const itemNames = [...metadata.items, ...bazaarNames]
      .filter((item) => typeof item.name === "string" && item.name.length > 3)
      .sort((a, b) => b.name.length - a.name.length);
    const contactPrices = Object.fromEntries(
      contacts.contacts.map((contact) => {
        const requirement = contact.requirement;
        const coin = /([\d,]+) coins?/i.exec(requirement);
        let total = coin ? Number(coin[1].replaceAll(",", "")) : 0;
        const matched: string[] = [];
        let foundItem = false,
          unavailable = false;
        for (const item of itemNames) {
          const name = item.name.replace(/§./g, "");
          if (
            matched.some((existing) => existing.includes(name)) ||
            !requirement.toLowerCase().includes(name.toLowerCase())
          )
            continue;
          foundItem = true;
          matched.push(name);
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const quantity = Number(
            new RegExp(`([\\d,]+)x?\\s+${escaped}`, "i")
              .exec(requirement)?.[1]
              ?.replaceAll(",", "") ?? 1,
          );
          const auctionPrice = m.offers
            .filter((offer) =>
              item.id.startsWith("PET_")
                ? offer.itemId.startsWith(item.id)
                : offer.itemId === item.id,
            )
            .sort((a, b) => a.price - b.price)[0]?.price;
          const price =
            quoteBook(m.books[item.id], quantity) ??
            (auctionPrice === undefined ? null : auctionPrice * quantity);
          if (price === null) unavailable = true;
          else total += price;
        }
        if (contact.npc === "George") {
          const allowed = [
            "AMMONITE",
            "ARMADILLO",
            "BEE",
            "BLUE_WHALE",
            "CHICKEN",
            "ELEPHANT",
            "ENDERMAN",
            "GIRAFFE",
            "GRIFFIN",
            "JERRY",
            "MONKEY",
            "PIG",
            "RABBIT",
            "SILVERFISH",
            "TIGER",
            "WOLF",
          ];
          const cheapest = allowed
            .map(
              (type) =>
                m.offers
                  .filter(
                    (offer) =>
                      offer.itemId.startsWith(`PET_${type}_`) &&
                      offer.itemId.endsWith("_LVL1"),
                  )
                  .sort((a, b) => a.price - b.price)[0]?.price,
            )
            .filter((price): price is number => price !== undefined)
            .sort((a, b) => a - b)
            .slice(0, 3);
          if (cheapest.length === 3) {
            total = cheapest.reduce((sum, price) => sum + price, 0);
            foundItem = true;
            unavailable = false;
          }
        }
        const free = /^No requirement\.?$/i.test(requirement);
        const itemRequirement = /^(Giving|Give|Consuming)/i.test(requirement);
        return [
          contact.npc,
          {
            price: unavailable || (!free && !coin && !foundItem) ? null : total,
            source: free
              ? "Free"
              : unavailable || (itemRequirement && !foundItem)
                ? "Manual estimate required"
                : foundItem
                  ? contact.npc === "George"
                    ? "Live BIN estimate · three cheapest eligible level-one pets"
                    : matched.some((name) => name.endsWith("Pet"))
                      ? "Live Auction House BIN"
                      : "Live Bazaar"
                  : coin
                    ? "Fixed coin requirement"
                    : "Progression requirement",
          },
        ];
      }),
    );
    return NextResponse.json({
      ...m,
      books: undefined,
      recombPrice: quoteBook(m.books.RECOMBOBULATOR_3000, 1),
      contactPrices,
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
