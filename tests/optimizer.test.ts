import { describe, it, expect } from "vitest";
import { currentPower, slotExpansion, power } from "../src/lib/domain";
import { buildOptions, optimize, solve } from "../src/lib/optimizer";
import { lowestOffer, quoteBook } from "../src/lib/pricing";
import {
  defaultSettings,
  Item,
  Market,
  Offer,
  Owned,
  Recipe,
  Settings,
  Option,
  Rarity,
  rarityMP,
} from "../src/lib/models";
const item = (
  id: string,
  rarity: Rarity = "RARE",
  family = id,
  tier = 0,
): Item => ({
  id,
  name: id,
  rarity,
  family,
  tier,
  recombEligible: true,
  soulbound: false,
  requirements: [],
});
const own = (i: Item, recomb = false, active = true): Owned => ({
  id: i.id,
  rarity: i.rarity,
  recomb,
  active,
  soulbound: false,
});
const settings = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings,
  target: 8,
  budget: 100_000_000,
  capacity: 100,
  recomb: false,
  craft: false,
  ...patch,
});
const offer = (
  i: Item,
  price: number,
  recomb = false,
  rarity = i.rarity,
): Offer => ({
  id: `${i.id}-${recomb}`,
  itemId: i.id,
  price,
  recomb,
  rarity,
  end: Date.now() + 3600000,
  updatedAt: Date.now(),
  variant: `${i.id}:${rarity}:${recomb}`,
});
const market = (offers: Offer[] = [], price = 100): Market => ({
  offers,
  books: {
    RECOMBOBULATOR_3000: {
      buy_summary: [{ amount: 100, pricePerUnit: price }],
      sell_summary: [{ amount: 100, pricePerUnit: 50 }],
    },
  },
  bazaarUpdatedAt: Date.now(),
  auctionsUpdatedAt: Date.now(),
  stale: false,
  warnings: [],
});
const best = (
  items: Item[],
  owned: Owned[],
  m: Market,
  s: Settings,
  r: Recipe[] = [],
  manual: Record<string, number> = {},
) => optimize(items, owned, r, m, s, manual)[0];
describe("Magical Power and storage rules", () => {
  it("centralizes every configured rarity value", () => {
    for (const [r, n] of Object.entries(rarityMP))
      expect(power(item("X", r as Rarity), r as Rarity)).toBe(n);
  });
  it("only the highest family tier contributes, including recombobulated lower tiers", () => {
    const a = item("A", "RARE", "F", 0),
      b = item("B", "EPIC", "F", 1);
    expect(currentPower([own(a), own(a), own(b)], [a, b])).toBe(12);
  });
  it("does not count items outside the bag", () => {
    const i = item("A");
    expect(currentPower([own(i, false, false)], [i])).toBe(0);
  });
  it("supports unusual multiplier and manual conditional contribution", () => {
    const i = { ...item("H", "LEGENDARY"), mpMultiplier: 2 };
    expect(power(i, "MYTHIC")).toBe(44);
    expect(currentPower([{ ...own(i), mpOverride: 49 }], [i])).toBe(49);
  });
  it.each([
    [0, 0],
    [1, 12_000_000],
    [2, 12_000_000],
    [3, 24_000_000],
    [4, 24_000_000],
  ])("%i new slots costs %i", (slots, cost) =>
    expect(slotExpansion(slots, 0, defaultSettings)?.cost).toBe(cost),
  );
  it("supports marginal schedules and finite availability", () => {
    expect(
      slotExpansion(3, 0, { ...defaultSettings, slotSchedule: [12, 18] }),
    ).toEqual({ cost: 30, slots: 4, batches: 2 });
    expect(
      slotExpansion(3, 0, { ...defaultSettings, maxExpansions: 1 }),
    ).toBeNull();
  });
});
describe("Market sides and recombobulation", () => {
  it("uses cheapest sell offers with depth, never quick-status instant-sell price", () => {
    const b = {
      buy_summary: [
        { amount: 2, pricePerUnit: 20 },
        { amount: 1, pricePerUnit: 10 },
      ],
      sell_summary: [{ amount: 100, pricePerUnit: 3 }],
    };
    expect(quoteBook(b, 3)).toBe(50);
    expect(quoteBook(b, 4)).toBeNull();
    expect(quoteBook(b, 2, true)).toBeCloseTo(6.2);
  });
  it("Legendary -> Mythic gains 6 with the live acquisition price and zero new slots", () => {
    const i = item("A", "LEGENDARY");
    const p = best(
      [i],
      [own(i)],
      market([], 1234),
      settings({ recomb: true, target: 22, capacity: 1 }),
    );
    expect(p.gain).toBe(6);
    expect(p.cost).toBe(1234);
    expect(p.slotsUnlocked).toBe(0);
  });
  it("Rare -> Epic gains 4", () => {
    const i = item("A");
    expect(
      best([i], [own(i)], market(), settings({ recomb: true, target: 12 }))
        .gain,
    ).toBe(4);
  });
  it("never recombobulates twice", () => {
    const i = item("A", "EPIC");
    const p = best(
      [i],
      [own(i, true)],
      market(),
      settings({ recomb: true, target: 16 }),
    );
    expect(p.feasible).toBe(false);
    expect(p.recombs).toBe(0);
  });
  it("counts shared recombobulator order depth across families", () => {
    const a = item("A", "LEGENDARY"),
      b = item("B", "LEGENDARY");
    const m = market();
    m.books.RECOMBOBULATOR_3000.buy_summary = [
      { amount: 1, pricePerUnit: 100 },
      { amount: 1, pricePerUnit: 200 },
    ];
    const p = best(
      [a, b],
      [own(a), own(b)],
      m,
      settings({ recomb: true, target: 44 }),
    );
    expect(p.cost).toBe(300);
    expect(p.recombs).toBe(2);
    expect(p.steps.reduce((n, s) => n + s.cost, 0)).toBe(300);
  });
  it("missing prices never create free recombobulation", () => {
    const i = item("A");
    const m = { ...market(), books: {} };
    expect(
      best([i], [own(i)], m, settings({ recomb: true, target: 12 })).feasible,
    ).toBe(false);
  });
  it("groups BINs by canonical rarity/recomb state and ignores expired offers", () => {
    const i = item("A");
    const m = market([
      offer(i, 50),
      offer(i, 60, true, "EPIC"),
      { ...offer(i, 1), id: "expired", end: 0 },
    ]);
    expect(lowestOffer(m, "A", "RARE", false)?.price).toBe(50);
    expect(lowestOffer(m, "A", "EPIC", true)?.price).toBe(60);
  });
  it("buying already recombobulated can beat base purchase + recombobulator", () => {
    const i = item("A");
    const p = best(
      [i],
      [],
      market([offer(i, 50), offer(i, 60, true, "EPIC")]),
      settings({ recomb: true, target: 12 }),
    );
    expect(p.cost).toBe(60);
    expect(p.recombs).toBe(0);
    expect(p.steps).toHaveLength(1);
  });
});
describe("State-aware routes", () => {
  it("two new accessories share one full expansion; three require two", () => {
    const items = [
      item("A", "COMMON"),
      item("B", "COMMON"),
      item("C", "COMMON"),
    ];
    const m = market(items.map((i) => offer(i, 10)));
    const p = best(items, [], m, settings({ capacity: 0, target: 6 }));
    expect(p.cost).toBe(12_000_020);
    expect(p.slotsUnlocked).toBe(2);
    const q = best(items, [], m, settings({ capacity: 0, target: 9 }));
    expect(q.cost).toBe(24_000_030);
    expect(q.slotsUnlocked).toBe(4);
    expect(q.steps[0].type).toBe("slots");
  });
  it("competing family replacements and recombs cannot stack", () => {
    const a = item("A", "RARE", "F"),
      b = item("B", "LEGENDARY", "F", 1);
    const p = best(
      [a, b],
      [own(a)],
      market([offer(b, 150)]),
      settings({ recomb: true, target: 22 }),
    );
    expect(p.cost).toBe(250);
    expect(p.gain).toBe(14);
    expect(p.finalMP).toBe(22);
  });
  it("crafting predecessor is consumed once and beats direct BIN", () => {
    const a = item("A", "RARE", "F"),
      b = item("B", "EPIC", "F", 1);
    const m = market([offer(b, 100)]);
    m.books.MATERIAL = {
      buy_summary: [{ amount: 100, pricePerUnit: 2 }],
      sell_summary: [],
    };
    const recipe: Recipe = {
      from: "A",
      to: "B",
      materials: { MATERIAL: 5 },
      fee: 1,
      requirements: [],
      preserveRecomb: false,
      source: "test",
    };
    const p = best([a, b], [own(a)], m, settings({ craft: true, target: 12 }), [
      recipe,
    ]);
    expect(p.cost).toBe(11);
    expect(p.steps[0].type).toBe("craft");
    expect(p.slotsUnlocked).toBe(0);
    expect(p.shopping.some((r) => r.id === "A")).toBe(false);
  });
  it("orders multi-step crafting before the final recombobulation", () => {
    const a = item("A", "COMMON", "F"),
      b = item("B", "RARE", "F", 1),
      c = item("C", "LEGENDARY", "F", 2);
    const recipes = [
      {
        from: "A",
        to: "B",
        materials: { M: 1 },
        fee: 0,
        requirements: [],
        preserveRecomb: false,
        source: "test",
      },
      {
        from: "B",
        to: "C",
        materials: { M: 2 },
        fee: 0,
        requirements: [],
        preserveRecomb: false,
        source: "test",
      },
    ];
    const m = market();
    m.books.M = {
      buy_summary: [{ amount: 50, pricePerUnit: 2 }],
      sell_summary: [],
    };
    const p = best(
      [a, b, c],
      [own(a)],
      m,
      settings({ target: 22, craft: true, recomb: true }),
      recipes,
    );
    expect(p.steps.map((s) => s.type)).toEqual(["craft", "craft", "recomb"]);
    expect(p.cost).toBe(106);
    expect(p.steps.at(-1)?.cumulativeMP).toBe(22);
  });
  it("does not invent recomb carry-over and permits outsourced gated crafts", () => {
    const a = item("A", "RARE", "F"),
      b = item("B", "EPIC", "F", 1);
    const r: Recipe = {
      from: "A",
      to: "B",
      materials: { M: 1 },
      fee: 0,
      requirements: ["slayer 5"],
      preserveRecomb: false,
      source: "test",
    };
    const m = market();
    m.books.M = {
      buy_summary: [{ amount: 50, pricePerUnit: 1 }],
      sell_summary: [],
    };
    expect(
      best([a, b], [own(a, true)], m, settings({ target: 12, craft: true }), [
        r,
      ]).feasible,
    ).toBe(false);
    expect(
      best([a, b], [own(a)], m, settings({ target: 12, craft: true }), [r])
        .feasible,
    ).toBe(true);
    expect(
      best([a, b], [own(a)], m, settings({ target: 12, craft: true }), [r])
        .steps[0].requirements,
    ).toContain("slayer 5");
  });
  it("owned accessories do not need rebuying; outside-bag items can be equipped", () => {
    const i = item("A");
    const p = best([i], [own(i, false, false)], market(), settings());
    expect(p.cost).toBe(0);
    expect(p.steps[0].type).toBe("equip");
  });
  it("does not assume soulbound resale proceeds", () => {
    const a = item("A", "RARE", "F"),
      b = item("B", "EPIC", "F", 1);
    expect(
      best(
        [a, b],
        [{ ...own(a), soulbound: true }],
        market([offer(a, 90), offer(b, 100)]),
        settings({ target: 12 }),
      ).cost,
    ).toBe(100);
  });
  it("keeps target-mode budget and chooses maximum feasible MP in budget mode", () => {
    const a = item("A", "RARE"),
      b = item("B", "LEGENDARY");
    const m = market([offer(a, 10), offer(b, 20)]);
    expect(
      best([a, b], [], m, settings({ target: 24, budget: 29 })).feasible,
    ).toBe(false);
    const p = best([a, b], [], m, settings({ mode: "budget", budget: 25 }));
    expect(p.gain).toBe(16);
    expect(p.cost).toBe(20);
  });
  it("prefers higher MP at equal target cost and lower cost at equal budget MP", () => {
    const a = item("A", "RARE"),
      b = item("B", "EPIC"),
      c = item("C", "EPIC");
    const m = market([offer(a, 10), offer(b, 10), offer(c, 15)]);
    const p = best([a, b, c], [], m, settings({ budget: 10 }));
    expect(p.finalMP).toBe(12);
    expect(p.cost).toBe(10);
  });
  it("manual mode works with empty bag and unavailable market", () => {
    const i = item("A");
    const p = best(
      [i],
      [],
      { ...market(), books: {}, offers: [] },
      settings(),
      [],
      { A: 123 },
    );
    expect(p.cost).toBe(123);
    expect(p.finalMP).toBe(8);
    expect(p.shopping[0].source).toBe("manual");
  });
  it("cannot purchase the same auction listing for two recipes", () => {
    const a = item("A"),
      b = item("B");
    const m = market();
    const shared = { ...offer(item("M"), 1), id: "unique" };
    m.offers.push(shared);
    const step = {
      itemId: "A",
      name: "A",
      type: "craft" as const,
      cost: 1,
      gain: 8,
      resources: [
        {
          id: "M",
          name: "M",
          quantity: 1,
          source: "auction" as const,
          offerId: "unique",
        },
      ],
      requirements: [],
      source: "test",
      updatedAt: Date.now(),
    };
    const groups: Option[][] = [
      [{ family: a.family, gain: 8, slots: 1, steps: [step] }],
      [{ family: b.family, gain: 8, slots: 1, steps: [step] }],
    ];
    const p = solve(groups, 0, 0, m, settings({ target: 16 }));
    expect(p.feasible).toBe(false);
    expect(p.gain).toBe(8);
  });
  it("stops circular upgrade paths", () => {
    const a = item("A", "RARE", "F"),
      b = item("B", "EPIC", "F", 1);
    const r: Recipe[] = [
      {
        from: "A",
        to: "B",
        materials: {},
        fee: 1,
        requirements: [],
        preserveRecomb: false,
        source: "test",
      },
      {
        from: "B",
        to: "A",
        materials: {},
        fee: 1,
        requirements: [],
        preserveRecomb: false,
        source: "test",
      },
    ];
    expect(
      buildOptions([a, b], [own(a)], r, market(), settings({ craft: true }))
        .groups[0].length,
    ).toBe(1);
  });
  it("matches exhaustive enumeration on 60 deterministic small instances", () => {
    let seed = 937;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed;
    };
    for (let t = 0; t < 60; t++) {
      const ids = Array.from({ length: 6 }, (_, i) =>
        item(`I${i}`, (["COMMON", "RARE", "LEGENDARY"] as const)[random() % 3]),
      );
      const costs = ids.map(() => 1 + (random() % 40));
      const target = 1 + (random() % 65);
      const capacity = random() % 5;
      const s = settings({ target, capacity, budget: 1000, slotCost: 15 });
      let optimal = Infinity,
        final = 0;
      for (let mask = 0; mask < 64; mask++) {
        let gain = 0,
          cost = 0,
          slots = 0;
        ids.forEach((i, j) => {
          if (mask & (1 << j)) {
            gain += rarityMP[i.rarity];
            cost += costs[j];
            slots++;
          }
        });
        cost += slotExpansion(slots, capacity, s)!.cost;
        if (
          gain >= target &&
          (cost < optimal || (cost === optimal && gain > final))
        ) {
          optimal = cost;
          final = gain;
        }
      }
      const p = best(ids, [], market(ids.map((i, j) => offer(i, costs[j]))), s);
      expect(p.status).toBe("exact");
      expect(p.feasible).toBe(Number.isFinite(optimal));
      if (p.feasible) {
        expect(p.cost).toBe(optimal);
        expect(p.finalMP).toBe(final);
      }
    }
  });
});
