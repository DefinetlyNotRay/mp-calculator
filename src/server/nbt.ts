import "server-only";
import { gunzipSync } from "node:zlib";
import { parseUncompressed, simplify } from "prismarine-nbt";
import { z } from "zod";
import { Item, Owned, Rarity, nextRarity, rarities } from "../lib/models";
export const inventoryItem = z
  .object({
    tag: z
      .object({
        ExtraAttributes: z.record(z.string(), z.unknown()).optional(),
        display: z
          .object({
            Name: z.string().optional(),
            Lore: z.array(z.string()).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();
export type Decoded = z.infer<typeof inventoryItem>;
export function decodeInventory(encoded: string): Decoded[] {
  if (encoded.length > 8_000_000)
    throw new Error("Inventory payload is too large.");
  let buf = Buffer.from(encoded, "base64");
  if (buf[0] === 0x1f && buf[1] === 0x8b)
    buf = gunzipSync(buf, { maxOutputLength: 16_000_000 });
  const parsed = simplify(parseUncompressed(buf));
  return z.object({ i: z.array(inventoryItem) }).parse(parsed).i;
}
export function identity(
  entry: Decoded,
  items: Item[],
  active = false,
): Owned | null {
  const attr = entry.tag?.ExtraAttributes;
  if (!attr) return null;
  const id = attr.id;
  if (typeof id !== "string") return null;
  const item = items.find((x) => x.id === id);
  if (!item) return null;
  const recomb = Number(attr.rarity_upgrades ?? 0) > 0;
  const lore = entry.tag?.display?.Lore?.map((x) => x.replace(/§./g, "")) ?? [];
  const last = lore.findLast((x) => /ACCESSORY/.test(x));
  const detected = [...rarities]
    .sort((a, b) => b.length - a.length)
    .find((r) => last?.includes(r.replaceAll("_", " ")));
  let rarity: Rarity =
    detected ??
    (recomb ? (nextRarity[item.rarity] ?? item.rarity) : item.rarity);
  if (last?.includes("VERY SPECIAL")) rarity = "VERY_SPECIAL";
  const mpLine = lore
    .map((l) => /Accessory Power: \+([\d.]+)/.exec(l))
    .find(Boolean);
  const override = mpLine ? Number(mpLine[1]) : undefined;
  return {
    id,
    rarity,
    recomb,
    soulbound:
      item.soulbound ||
      !!attr.donated_museum ||
      !!attr.coop_soulbound ||
      lore.some((l) => l.includes("Soulbound")),
    active,
    mpOverride: item.conditional ? override : undefined,
    instance: typeof attr.uuid === "string" ? attr.uuid : undefined,
  };
}
