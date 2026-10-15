import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { guard } from "../src/server/http";
import { optimize } from "../src/lib/optimizer";
import { quoteBook } from "../src/lib/pricing";
import { defaultSettings, Item, Market, Owned } from "../src/lib/models";
describe("Regression checks", () => {
  it("uses Hypixel instant-buy asks, never a deeply discounted bid as an acquisition price", () => {
    const book = {
      buy_summary: [{ amount: 300, pricePerUnit: 25000 }],
      sell_summary: [
        { amount: 20, pricePerUnit: 24000 },
        { amount: 1000, pricePerUnit: 0.4 },
      ],
    };
    expect(quoteBook(book, 256)).toBe(6_400_000);
    expect(quoteBook(book, 1, true)).toBe(24000.1);
  });
  it("permits the browser Host even if Next rewrites the internal URL", () => {
    expect(() =>
      guard(
        new Request("http://localhost:3000/api/optimize", {
          headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
        }),
      ),
    ).not.toThrow();
  });
  it("rejects a cross-origin caller", () => {
    expect(() =>
      guard(
        new Request("http://localhost:3000/api/optimize", {
          headers: { origin: "https://example.org", host: "127.0.0.1:3000" },
        }),
      ),
    ).toThrow("Cross-origin");
  });
  it("frees suppressed accessory slots before purchasing new families", () => {
    const a: Item = {
      id: "A",
      name: "A",
      rarity: "COMMON",
      family: "F",
      tier: 0,
      recombEligible: true,
      soulbound: false,
      requirements: [],
    };
    const b: Item = { ...a, id: "B", name: "B", tier: 1, rarity: "RARE" };
    const c: Item = { ...a, id: "C", name: "C", family: "C" };
    const owned: Owned[] = [
      {
        id: "A",
        rarity: "COMMON",
        active: true,
        recomb: false,
        soulbound: false,
      },
      {
        id: "B",
        rarity: "RARE",
        active: true,
        recomb: false,
        soulbound: false,
      },
    ];
    const m: Market = {
      books: {},
      offers: [],
      warnings: [],
      stale: false,
      bazaarUpdatedAt: null,
      auctionsUpdatedAt: null,
    };
    const p = optimize(
      [a, b, c],
      owned,
      [],
      m,
      {
        ...defaultSettings,
        target: 11,
        capacity: 2,
        keepDuplicates: true,
        recomb: false,
        craft: false,
      },
      { C: 100 },
    )[0];
    expect(p.cost).toBe(100);
    expect(p.slotsUnlocked).toBe(0);
    expect(p.steps[0].type).toBe("unequip");
    expect(p.finalMP).toBe(11);
  });
  it("can keep duplicate Personal Deletors occupying their bag slots", () => {
    const a: Item = {
      id: "PERSONAL_DELETOR_4000",
      name: "A",
      rarity: "COMMON",
      family: "F",
      tier: 0,
      recombEligible: true,
      soulbound: false,
      requirements: [],
    };
    const duplicate: Item = {
      ...a,
      id: "PERSONAL_DELETOR_5000",
      name: "B",
      tier: 1,
    };
    const next: Item = { ...a, id: "C", name: "C", family: "C" };
    const owned: Owned[] = [a, duplicate].map((item) => ({
      id: item.id,
      rarity: item.rarity,
      active: true,
      recomb: false,
      soulbound: false,
    }));
    const market: Market = {
      books: {},
      offers: [],
      warnings: [],
      stale: false,
      bazaarUpdatedAt: null,
      auctionsUpdatedAt: null,
    };
    const plan = optimize(
      [a, duplicate, next],
      owned,
      [],
      market,
      {
        ...defaultSettings,
        target: 6,
        capacity: 2,
        slotBatch: 1,
        slotCost: 50,
        slotSchedule: [],
        keepDuplicates: true,
        recomb: false,
        craft: false,
      },
      { C: 100 },
    )[0];
    expect(plan.cost).toBe(150);
    expect(plan.slotsUnlocked).toBe(1);
    expect(plan.steps.some((step) => step.type === "unequip")).toBe(false);
  });
  it("quotes extra copies in repeated-accessory crafting separately from the owned predecessor", () => {
    const a: Item = {
      id: "A",
      name: "A",
      rarity: "RARE",
      family: "F",
      tier: 0,
      recombEligible: true,
      soulbound: false,
      requirements: [],
    };
    const b: Item = { ...a, id: "B", name: "B", tier: 1, rarity: "EPIC" };
    const owned: Owned[] = [
      {
        id: "A",
        rarity: "RARE",
        active: true,
        recomb: false,
        soulbound: false,
      },
    ];
    const m: Market = {
      books: {},
      offers: [],
      warnings: [],
      stale: false,
      bazaarUpdatedAt: null,
      auctionsUpdatedAt: null,
    };
    const p = optimize(
      [a, b],
      owned,
      [
        {
          from: "A",
          to: "B",
          materials: { A: 3 },
          fee: 0,
          requirements: [],
          preserveRecomb: false,
          source: "test",
        },
      ],
      m,
      { ...defaultSettings, target: 12, recomb: false, craft: true },
      { A: 10 },
    )[0];
    expect(p.cost).toBe(30);
    expect(p.shopping[0].quantity).toBe(3);
    expect(p.finalMP).toBe(12);
  });
});
