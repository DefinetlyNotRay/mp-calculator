import { beforeEach, describe, it, expect, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { writeUncompressed, NBT } from "prismarine-nbt";
vi.mock("server-only", () => ({}));
import { hypixel } from "../src/server/hypixel";
import { cached } from "../src/server/cache";
import { decodeInventory, identity } from "../src/server/nbt";
import { catalog } from "../src/server/catalog";
const response = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.HYPIXEL_API_KEY = "test-server-key";
});
describe("Hypixel integration without live network", () => {
  it("sends credentials only as a server-side header for authenticated endpoints", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ success: true, profiles: [] }));
    vi.stubGlobal("fetch", fetcher);
    await hypixel("/v2/skyblock/profiles?uuid=abc", true);
    expect(fetcher.mock.calls[0][1].headers).toEqual({
      "API-Key": "test-server-key",
    });
    expect(fetcher.mock.calls[0][0]).not.toContain("test-server-key");
  });
  it("public resource requests do not include the key", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ success: true, items: [] }));
    vi.stubGlobal("fetch", fetcher);
    await hypixel("/v2/resources/skyblock/items");
    expect(fetcher.mock.calls[0][1].headers).toEqual({});
  });
  it.each([403, 503])("exposes a useful %i error", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, status)));
    await expect(hypixel("/v2/skyblock/profiles", true)).rejects.toMatchObject({
      status,
    });
  });
  it("rejects success=false and malformed envelopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(response({ success: false, cause: "Unavailable" })),
    );
    await expect(hypixel("/v2/skyblock/bazaar")).rejects.toThrow("Unavailable");
  });
  it("deduplicates concurrent refresh requests", async () => {
    const load = vi.fn(async () => ({ price: 123 }));
    const key = `dedup-${Date.now()}`;
    const [a, b] = await Promise.all([
      cached(key, 10000, load),
      cached(key, 10000, load),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a.value).toEqual(b.value);
  });
  it("returns last successful data as explicitly stale when refresh fails", async () => {
    const key = `stale-${Date.now()}`;
    await cached(key, -1, async () => ({ price: 500 }));
    const data = await cached<{ price: number }>(key, 10000, async () => {
      throw new Error("503 upstream");
    });
    expect(data.stale).toBe(true);
    expect(data.value.price).toBe(500);
    expect(data.warning).toContain("503");
  });
  it("decodes compressed NBT and distinguishes uncommon from common", () => {
    const nbt: NBT = {
      name: "",
      type: "compound",
      value: {
        i: {
          type: "list",
          value: {
            type: "compound",
            value: [
              {
                tag: {
                  type: "compound",
                  value: {
                    ExtraAttributes: {
                      type: "compound",
                      value: {
                        id: { type: "string", value: "SPEED_TALISMAN" },
                        rarity_upgrades: { type: "int", value: 1 },
                      },
                    },
                    display: {
                      type: "compound",
                      value: {
                        Lore: {
                          type: "list",
                          value: {
                            type: "string",
                            value: ["§a§lUNCOMMON ACCESSORY"],
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    };
    const entries = decodeInventory(
      gzipSync(writeUncompressed(nbt)).toString("base64"),
    );
    const result = identity(entries[0], catalog, true);
    expect(result?.id).toBe("SPEED_TALISMAN");
    expect(result?.rarity).toBe("UNCOMMON");
    expect(result?.recomb).toBe(true);
    expect(result?.active).toBe(true);
  });
  it("imports anniversary hatcessories omitted by Hypixel item resources", () => {
    const item = catalog.find(
      (candidate) => candidate.id === "BALLOON_HAT_2024",
    );
    expect(item).toMatchObject({
      rarity: "SPECIAL",
      mpOverride: 3,
      recombEligible: false,
    });
    expect(
      identity(
        {
          tag: {
            ExtraAttributes: { id: "BALLOON_HAT_2024" },
            display: {
              Lore: ["§7Accessory Power: §6+3", "§c§lSPECIAL HATCESSORY"],
            },
          },
        },
        catalog,
        true,
      ),
    ).toMatchObject({
      id: "BALLOON_HAT_2024",
      rarity: "SPECIAL",
      active: true,
    });
  });
  it("429 honors retry headers and suppresses subsequent requests", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({}, 429, { "RateLimit-Reset": "30" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(hypixel("/v2/skyblock/profiles", true)).rejects.toMatchObject({
      status: 429,
    });
    await expect(hypixel("/v2/skyblock/profiles", true)).rejects.toMatchObject({
      status: 429,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
