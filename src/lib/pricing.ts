import { Book, Market, Resource, Settings } from "./models";
export function quoteBook(
  book: Book | undefined,
  quantity: number,
  buyOrder = false,
  fee = 0,
): number | null {
  if (!book || quantity <= 0) return quantity === 0 ? 0 : null;
  if (buyOrder) {
    const best = Math.max(
      ...book.sell_summary
        .filter((x) => x.amount > 0 && x.pricePerUnit > 0)
        .map((x) => x.pricePerUnit),
    );
    return Number.isFinite(best) ? quantity * (best + 0.1) * (1 + fee) : null;
  }
  let left = quantity,
    total = 0;
  // Hypixel names these by the instant player's transaction: buy_summary is the ask book.
  for (const row of [...book.buy_summary].sort(
    (a, b) => a.pricePerUnit - b.pricePerUnit,
  )) {
    if (row.amount <= 0 || row.pricePerUnit <= 0) continue;
    const n = Math.min(left, row.amount);
    total += n * row.pricePerUnit;
    left -= n;
    if (left <= 0) return total * (1 + fee);
  }
  return null;
}
export function consolidate(resources: Resource[]): Resource[] {
  const map = new Map<string, Resource>();
  for (const r of resources) {
    const key = [r.source, r.id, r.offerId ?? "", r.manualUnit ?? ""].join(":");
    const old = map.get(key);
    map.set(
      key,
      old ? { ...old, quantity: old.quantity + r.quantity } : { ...r },
    );
  }
  return [...map.values()];
}
const indexes = new WeakMap<Market, Map<string, Market["offers"][number]>>();
export function quoteResources(
  resources: Resource[],
  market: Market,
  s: Settings,
): number | null {
  let index = indexes.get(market);
  if (!index) {
    index = new Map(market.offers.map((o) => [o.id, o]));
    indexes.set(market, index);
  }
  let total = 0;
  for (const r of consolidate(resources)) {
    let p: number | null = null;
    if (r.source === "bazaar")
      p = quoteBook(market.books[r.id], r.quantity, s.buyOrders, s.bazaarFee);
    if (r.source === "manual")
      p = r.manualUnit !== undefined ? r.manualUnit * r.quantity : null;
    if (r.source === "auction") {
      const o = index.get(r.offerId ?? "");
      p = o && o.end > Date.now() && r.quantity === 1 ? o.price : null;
    }
    if (p === null) return null;
    total += p;
  }
  return total;
}
export function lowestOffer(
  market: Market,
  id: string,
  rarity: string,
  recomb: boolean,
) {
  return market.offers
    .filter(
      (o) =>
        o.itemId === id &&
        o.rarity === rarity &&
        o.recomb === recomb &&
        o.end > Date.now() &&
        o.price > 0,
    )
    .sort((a, b) => a.price - b.price)[0];
}
