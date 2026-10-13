import "server-only";
import metadata from "../../data/items.json";
import rules from "../../data/rules.json";
import { Item, Recipe, Rarity, rarities, rarityMP } from "../lib/models";
const upgrades = rules.upgrades as Record<string, string[]>;
const roots = new Map<string, string>();
function root(id: string): string {
  const p = roots.get(id);
  if (!p || p === id) return id;
  const r = root(p);
  roots.set(id, r);
  return r;
}
function union(a: string, b: string) {
  const ar = root(a),
    br = root(b);
  if (ar !== br) roots.set(br, ar);
}
for (const [id, children] of Object.entries(upgrades))
  for (const child of children) union(id, child);
const ruleMap = new Map(rules.items.map((i) => [i.id, i]));
function reqs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) =>
    Object.entries(r)
      .map(([k, v]) => `${k}=${v}`)
      .join(" • "),
  );
}
export function makeCatalog(raw: unknown[] = metadata.items): Item[] {
  const items: Item[] = raw.flatMap((entry) => {
    const d = entry as Record<string, unknown>;
    if (
      d.category !== "ACCESSORY" ||
      typeof d.id !== "string" ||
      typeof d.name !== "string"
    )
      return [];
    const rarity = rarities.includes(d.tier as Rarity)
      ? (d.tier as Rarity)
      : "COMMON";
    const rule = ruleMap.get(d.id);
    const lore = rule?.lore.join(" ").replace(/§./g, "") ?? "";
    const found = /Accessory Power: \+([\d.]+)/.exec(lore);
    const value = found ? Number(found[1]) : undefined;
    const multiplier = d.id === "HEGEMONY_ARTIFACT" ? 2 : undefined;
    const conditional =
      /contacts|magical power.*per|accessory power.*per/i.test(lore) ||
      d.id === "ABICASE" ||
      d.id === "PULSE_RING" ||
      d.id === "PANDORAS_BOX";
    return [
      {
        id: d.id,
        name: d.name,
        rarity,
        family: root(d.id),
        tier: Object.entries(upgrades).filter(([, children]) =>
          children.includes(d.id as string),
        ).length,
        recombEligible:
          d.can_recombobulate !== false &&
          rarity !== "ULTIMATE" &&
          rarity !== "DIVINE",
        soulbound: !!d.soulbound,
        requirements: reqs(d.requirements),
        mpMultiplier: multiplier,
        mpOverride:
          !conditional &&
          value !== undefined &&
          value !== rarityMP[rarity] * (multiplier ?? 1)
            ? value
            : undefined,
        conditional: conditional
          ? "Contribution depends on player or item state"
          : undefined,
      },
    ];
  });

  // Anniversary hatcessories use a generic NBT id plus color/year attributes and
  // are absent from Hypixel's item resource. Keep explicit entries for profile
  // imports; all anniversary hats belong to the same non-stacking family.
  const anniversaryFamily = root("BALLOON_HAT_2024_AQUA");
  const hatcessories: Item[] = [
    ["BALLOON_HAT_2024", "5th Anniversary Balloon Hat"],
    ["BALLOON_HAT_2025", "6th Anniversary Balloon Hat"],
    ["CAKE_HAT_2026", "7th Anniversary Cake Hat"],
  ].map(([id, name]) => ({
    id,
    name,
    rarity: "SPECIAL",
    family: anniversaryFamily,
    tier: 0,
    recombEligible: false,
    soulbound: false,
    requirements: [],
    mpOverride: 3,
  }));
  for (const item of hatcessories)
    if (!items.some((candidate) => candidate.id === item.id)) items.push(item);
  return items;
}
export const catalog = makeCatalog();
// Recomb carry-over is intentionally disabled unless reviewed for an individual recipe.
// Cross-family consumption needs a separate ownership model.
export const recipes: Recipe[] = rules.items.flatMap((rule) =>
  rule.recipes.flatMap((raw) => {
    const r = raw as Record<string, unknown>;
    if (r.type !== "crafting" || Number(r.count ?? 1) !== 1) return [];
    const target = catalog.find((i) => i.id === rule.id);
    if (!target) return [];
    const materials: Record<string, number> = {};
    for (const [key, val] of Object.entries(r)) {
      if (!/^[ABC][123]$/.test(key) || typeof val !== "string" || !val)
        continue;
      const split = val.lastIndexOf(":");
      if (split < 0) return [];
      const id = val.slice(0, split),
        n = Number(val.slice(split + 1));
      if (!n || n < 0) return [];
      materials[id] = (materials[id] ?? 0) + n;
    }
    const predecessors = Object.keys(materials).filter((id) =>
      catalog.some((i) => i.id === id),
    );
    if (predecessors.length > 1) return [];
    let from: string | undefined;
    if (predecessors.length) {
      from = predecessors[0];
      const p = catalog.find((i) => i.id === from)!;
      if (
        materials[from] < 1 ||
        p.family !== target.family ||
        from === target.id
      )
        return [];
      materials[from] -= 1;
      if (materials[from] === 0) delete materials[from];
    }
    const requirements = [
      ...target.requirements,
      ...(rule.crafttext ? [rule.crafttext] : []),
    ];
    return [
      {
        from,
        to: target.id,
        materials,
        fee: 0,
        requirements,
        preserveRecomb: false,
        source: `NEU ${rules.commit.slice(0, 7)}`,
      },
    ];
  }),
);
export const coverage = {
  items: catalog.length,
  rules: rules.items.length,
  recipes: recipes.length,
  commit: rules.commit,
  syncedAt: rules.syncedAt,
  source: rules.source,
};
