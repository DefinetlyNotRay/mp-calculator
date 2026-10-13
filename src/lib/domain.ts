import { Item, Owned, Rarity, rarityMP, Settings } from "./models";
export function power(item: Item, rarity: Rarity, override?: number): number {
  return (
    override ?? item.mpOverride ?? rarityMP[rarity] * (item.mpMultiplier ?? 1)
  );
}
export function effectiveCollection(
  owned: Owned[],
  items: Item[],
): Map<string, Owned> {
  const catalog = new Map(items.map((i) => [i.id, i]));
  const result = new Map<string, Owned>();
  for (const o of owned) {
    const i = catalog.get(o.id);
    if (!i || !o.active) continue;
    const prev = result.get(i.family);
    const p = prev ? catalog.get(prev.id) : undefined;
    if (
      !prev ||
      !p ||
      i.tier > p.tier ||
      (i.tier === p.tier &&
        power(i, o.rarity, o.mpOverride) >
          power(p, prev.rarity, prev.mpOverride))
    )
      result.set(i.family, o);
  }
  return result;
}
export function currentPower(owned: Owned[], items: Item[]): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  return [...effectiveCollection(owned, items).values()].reduce(
    (n, o) => n + power(byId.get(o.id)!, o.rarity, o.mpOverride),
    0,
  );
}
export function slotExpansion(
  newSlots: number,
  free: number,
  s: Pick<
    Settings,
    "slotBatch" | "slotCost" | "slotSchedule" | "maxExpansions"
  >,
) {
  const batches = Math.ceil(Math.max(0, newSlots - free) / s.slotBatch);
  if (batches > s.maxExpansions) return null;
  let cost = 0;
  for (let i = 0; i < batches; i++) cost += s.slotSchedule[i] ?? s.slotCost;
  return { cost, slots: batches * s.slotBatch, batches };
}
