import "server-only";
import { z } from "zod";
import { hypixel, resolvePlayer, ApiError } from "./hypixel";
import { cached, ttl } from "./cache";
import { getItems } from "./market";
import { catalog } from "./catalog";
import { decodeInventory, identity } from "./nbt";
import { Owned } from "../lib/models";
import { currentPower } from "../lib/domain";
import { jacobusSlotPricing } from "../lib/models";
const profileSchema = z.object({
  profile_id: z.string(),
  cute_name: z.string().optional(),
  selected: z.boolean().optional(),
  game_mode: z.string().optional(),
  members: z.record(z.string(), z.record(z.string(), z.unknown())),
});
export async function listProfiles(input: string) {
  const player = await cached(`player:${input.toLowerCase()}`, 86400000, () =>
    resolvePlayer(input),
  );
  const profiles = await cached(
    `profiles:${player.value.uuid}`,
    ttl("PROFILES", 120),
    async () =>
      z
        .object({ profiles: z.array(profileSchema).nullable() })
        .parse(
          await hypixel(
            `/v2/skyblock/profiles?uuid=${player.value.uuid}`,
            true,
          ),
        ).profiles ?? [],
  );
  return {
    ...player.value,
    profiles: profiles.value.map((p) => ({
      id: p.profile_id,
      name: p.cute_name ?? "Unknown",
      selected: p.selected,
      mode: p.game_mode ?? "normal",
    })),
    updatedAt: profiles.updatedAt,
  };
}
export async function importProfile(uuid: string, profileId: string) {
  const fetched = await cached(
    `profile:${profileId}`,
    ttl("PROFILES", 120),
    async () =>
      z
        .object({ profile: profileSchema.nullable() })
        .parse(await hypixel(`/v2/skyblock/profile?profile=${profileId}`, true))
        .profile,
  );
  const member = fetched.value?.members[uuid];
  if (!member)
    throw new ApiError("Player is not a member of this profile.", 404);
  const items = await getItems()
    .then((x) => x.value)
    .catch(() => catalog);
  const inventory = (member.inventory ?? member) as Record<string, unknown>;
  const bag = (inventory.bag_contents ?? {}) as Record<string, unknown>;
  const accessory = (bag.talisman_bag ?? inventory.talisman_bag) as
    { data?: string } | undefined;
  const owned: Owned[] = [];
  const warnings: string[] = [];
  let capacity: number | null = null;
  let phone: { name: string; capacity: number } | null = null;
  let incomplete = !accessory?.data;
  const load = (data: string, active: boolean) => {
    try {
      const entries = decodeInventory(data);
      if (active) capacity = entries.length;
      for (const entry of entries) {
        const phoneId = entry.tag?.ExtraAttributes?.id;
        if (typeof phoneId === "string") {
          const phones: Record<string, { name: string; capacity: number }> = {
            ABIPHONE_BASIC: { name: "Abiphone Basic", capacity: 6 },
            ABIPHONE_X_PLUS: { name: "Abiphone X", capacity: 7 },
            ABIPHONE_X_PLUS_SPECIAL_EDITION: {
              name: "Abiphone X",
              capacity: 7,
            },
            ABIPHONE_XI_ULTRA: { name: "Abiphone XI", capacity: 8 },
            ABIPHONE_XI_ULTRA_STYLE: { name: "Abiphone XI", capacity: 8 },
            ABIPHONE_XII_MEGA: { name: "Abiphone XII", capacity: 9 },
            ABIPHONE_XII_MEGA_COLOR: { name: "Abiphone XII", capacity: 9 },
            ABIPHONE_XIII_PRO: { name: "Abiphone XIII", capacity: 10 },
            ABIPHONE_XIII_PRO_GIGA: { name: "Abiphone XIII", capacity: 10 },
            ABIPHONE_XIV_ENORMOUS: { name: "Abiphone XIV", capacity: 11 },
            ABIPHONE_XIV_ENORMOUS_PURPLE: {
              name: "Abiphone XIV",
              capacity: 11,
            },
            ABIPHONE_XIV_ENORMOUS_BLACK: { name: "Abiphone XIV", capacity: 11 },
          };
          const detected = phones[phoneId];
          if (detected && (!phone || detected.capacity > phone.capacity))
            phone = detected;
        }
        const item = identity(entry, items, active);
        if (item) owned.push(item);
      }
    } catch {
      incomplete = true;
      warnings.push(
        "An inventory could not be decoded. Review the collection manually.",
      );
    }
  };
  if (accessory?.data) load(accessory.data, true);
  else
    warnings.push(
      "Accessory bag data is private or unavailable. Your complete collection is unknown; use manual mode.",
    );
  for (const key of ["inv_contents", "ender_chest_contents"]) {
    const field = inventory[key] as { data?: string } | undefined;
    if (field?.data) load(field.data, false);
    else
      warnings.push(
        `${key === "inv_contents" ? "Inventory" : "Ender chest"} data unavailable; owned accessories there are unknown.`,
      );
  }
  const storage = inventory.backpack_contents as
    Record<string, { data?: string }> | undefined;
  for (const field of Object.values(storage ?? {}))
    if (field?.data) load(field.data, false);
  const tuning = member.accessory_bag_storage as
    Record<string, unknown> | undefined;
  const reported =
    typeof tuning?.highest_magical_power === "number"
      ? tuning.highest_magical_power
      : null;
  const slotUpgradesPurchased =
    typeof tuning?.bag_upgrades_purchased === "number"
      ? tuning.bag_upgrades_purchased
      : null;
  const abiphone = ((
    member.nether_island_player_data as Record<string, unknown> | undefined
  )?.abiphone ?? {}) as Record<string, unknown>;
  const activeContacts = Array.isArray(abiphone.active_contacts)
    ? abiphone.active_contacts.filter((x): x is string => typeof x === "string")
    : [];
  const computed = currentPower(owned, items);
  if (owned.some((o) => items.find((i) => i.id === o.id)?.conditional))
    warnings.push(
      "Conditional accessory contributions need review against your player and item state. Edit MP overrides if the lore does not include all conditional bonuses.",
    );
  if (reported !== null && reported !== computed)
    warnings.push(
      `Computed ${computed} MP; profile highest recorded MP is ${reported}. This is a historical maximum, not a guaranteed current value.`,
    );
  if (fetched.stale) warnings.push("Profile is cached and may be stale.");
  const detectedPhone = phone as { name: string; capacity: number } | null;
  return {
    owned,
    capacity,
    currentMP: computed,
    highestRecordedMP: reported,
    slotUpgradesPurchased,
    slotPricing:
      slotUpgradesPurchased === null
        ? null
        : jacobusSlotPricing(slotUpgradesPurchased),
    abiphone: {
      activeContacts,
      phoneName: detectedPhone?.name ?? null,
      baseCapacity: detectedPhone?.capacity ?? 0,
    },
    incomplete,
    warnings,
    updatedAt: fetched.updatedAt,
    profile: fetched.value?.cute_name,
    gameMode: fetched.value?.game_mode ?? "normal",
  };
}
