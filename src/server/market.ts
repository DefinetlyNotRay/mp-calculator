import "server-only";
import { z } from "zod";
import { cached, ttl, prisma } from "./cache";
import { hypixel, ApiError } from "./hypixel";
import { catalog, makeCatalog } from "./catalog";
import { decodeInventory, identity } from "./nbt";
import { Book, Market, Offer } from "../lib/models";
const row = z.object({
  amount: z.number().nonnegative(),
  pricePerUnit: z.number().nonnegative(),
});
const bazaarSchema = z.object({
  lastUpdated: z.number(),
  products: z.record(
    z.string(),
    z.object({ sell_summary: z.array(row), buy_summary: z.array(row) }),
  ),
});
const pageSchema = z.object({
  page: z.number().int(),
  totalPages: z.number().int().nonnegative().max(500),
  lastUpdated: z.number(),
  auctions: z.array(
    z.object({
      uuid: z.string(),
      bin: z.boolean().optional(),
      claimed: z.boolean().optional(),
      end: z.number(),
      starting_bid: z.number(),
      item_bytes: z.string(),
      category: z.string().optional(),
      item_lore: z.string().optional(),
    }),
  ),
});
export async function getItems() {
  return cached("items", ttl("ITEMS", 86400), async () => {
    const d = await hypixel("/v2/resources/skyblock/items");
    const parsed = z
      .object({ items: z.array(z.record(z.string(), z.unknown())) })
      .parse(d);
    const items = makeCatalog(parsed.items);
    const db = prisma;
    if (db)
      await db
        .$transaction(
          items.map((i) =>
            db.itemMetadata.upsert({
              where: { id: i.id },
              create: { id: i.id, payload: JSON.parse(JSON.stringify(i)) },
              update: { payload: JSON.parse(JSON.stringify(i)) },
            }),
          ),
        )
        .catch(() => undefined);
    return items;
  });
}
export async function getBazaar() {
  return cached("bazaar", ttl("BAZAAR", 60), async () =>
    bazaarSchema.parse(await hypixel("/v2/skyblock/bazaar")),
  );
}
export async function ingestAuctions(): Promise<{
  offers: Offer[];
  lastUpdated: number;
  skipped: number;
}> {
  const items = await getItems()
    .then((r) => r.value)
    .catch(() => catalog);
  const first = pageSchema.parse(await hypixel("/v2/skyblock/auctions?page=0"));
  const offers: Offer[] = [];
  let skipped = 0;
  const processPage = (page: z.infer<typeof pageSchema>) => {
    if (
      page.lastUpdated !== first.lastUpdated ||
      page.totalPages !== first.totalPages
    )
      throw new ApiError(
        "Auction snapshot changed during ingestion. Refresh again to collect a consistent snapshot.",
      );
    for (const auction of page.auctions) {
      if (
        !auction.bin ||
        auction.claimed ||
        auction.end <= Date.now() ||
        auction.starting_bid <= 0
      )
        continue;
      try {
        const entry = decodeInventory(auction.item_bytes)[0];
        if (!entry) continue;
        const identified = identity(entry, items);
        const extra = entry.tag?.ExtraAttributes;
        if (!identified || identified.soulbound) continue;
        // Attribute-bearing and mutable variants are not safely comparable without item rules.
        const item = items.find((i) => i.id === identified.id)!;
        if (item.conditional || extra?.attributes || extra?.enrichment)
          continue;
        offers.push({
          id: auction.uuid,
          itemId: identified.id,
          rarity: identified.rarity,
          recomb: identified.recomb,
          price: auction.starting_bid,
          end: auction.end,
          updatedAt: first.lastUpdated,
          variant: `${identified.id}:${identified.rarity}:${identified.recomb}`,
        });
      } catch {
        skipped++;
      }
    }
  };
  processPage(first);
  let cursor = 1;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < first.totalPages) {
        const page = cursor++;
        processPage(
          pageSchema.parse(await hypixel(`/v2/skyblock/auctions?page=${page}`)),
        );
      }
    }),
  );
  if (prisma)
    await prisma.priceSnapshot
      .upsert({
        where: { key: "lowest-bin" },
        create: {
          key: "lowest-bin",
          payload: JSON.parse(JSON.stringify(offers)),
          updatedAt: new Date(first.lastUpdated),
        },
        update: {
          payload: JSON.parse(JSON.stringify(offers)),
          updatedAt: new Date(first.lastUpdated),
        },
      })
      .catch(() => undefined);
  return { offers, lastUpdated: first.lastUpdated, skipped };
}
export async function getAuctions() {
  return cached("auctions", ttl("AUCTIONS", 120), ingestAuctions);
}
export async function getMarket(includeAuctions = true): Promise<Market> {
  const [bazaar, auctions] = await Promise.allSettled([
    getBazaar(),
    includeAuctions ? getAuctions() : Promise.resolve(null),
  ]);
  const warnings: string[] = [];
  let books: Record<string, Book> = {},
    offers: Offer[] = [];
  let bazaarUpdatedAt: number | null = null,
    auctionsUpdatedAt: number | null = null,
    stale = false;
  if (bazaar.status === "fulfilled") {
    books = bazaar.value.value.products;
    bazaarUpdatedAt = bazaar.value.value.lastUpdated;
    stale ||= bazaar.value.stale;
    if (bazaar.value.warning) warnings.push(bazaar.value.warning);
  } else
    warnings.push(
      bazaar.reason instanceof Error
        ? bazaar.reason.message
        : "Bazaar unavailable",
    );
  if (auctions.status === "fulfilled" && auctions.value) {
    offers = auctions.value.value.offers.filter((o) => o.end > Date.now());
    auctionsUpdatedAt = auctions.value.value.lastUpdated;
    stale ||= auctions.value.stale;
    if (auctions.value.warning) warnings.push(auctions.value.warning);
    if (auctions.value.value.skipped)
      warnings.push(
        `${auctions.value.value.skipped} unreadable auction listings were excluded.`,
      );
  } else if (auctions.status === "rejected")
    warnings.push(
      auctions.reason instanceof Error
        ? auctions.reason.message
        : "Auctions unavailable",
    );
  if (!prisma)
    warnings.push(
      "Local memory cache active. Configure PostgreSQL for durable production caching.",
    );
  if (stale)
    warnings.push(
      "Last successful cached data is shown; fresh price data is unavailable.",
    );
  return { books, offers, bazaarUpdatedAt, auctionsUpdatedAt, warnings, stale };
}
