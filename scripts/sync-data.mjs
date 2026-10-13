import { mkdir, writeFile } from "node:fs/promises";
const root = new URL("../data/", import.meta.url);
await mkdir(root, { recursive: true });
const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Data download failed: ${r.status}`);
  return r.json();
};
const commit = (
  await get(
    "https://api.github.com/repos/NotEnoughUpdates/NotEnoughUpdates-REPO/commits/master",
  )
).sha;
const base = `https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/${commit}`;
const misc = await get(`${base}/constants/misc.json`);
const metadata = await get(
  "https://api.hypixel.net/v2/resources/skyblock/items",
);
const accessories = metadata.items.filter((x) => x.category === "ACCESSORY");
const records = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (cursor < accessories.length) {
      const item = accessories[cursor++];
      const r = await fetch(
        `${base}/items/${encodeURIComponent(item.id)}.json`,
      );
      if (r.ok) {
        const d = await r.json();
        records.push({
          id: item.id,
          lore: d.lore ?? [],
          recipes:
            d.recipes ??
            (d.recipe ? [{ ...d.recipe, type: "crafting", count: 1 }] : []),
          crafttext: d.crafttext ?? null,
          slayer_req: d.slayer_req ?? null,
        });
      }
    }
  }),
);
records.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(
  new URL("rules.json", root),
  JSON.stringify(
    {
      commit,
      source: "https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO",
      syncedAt: new Date().toISOString(),
      upgrades: misc.talisman_upgrades,
      ignored: misc.ignored_talisman,
      items: records,
    },
    null,
    2,
  ),
);
await writeFile(
  new URL("items.json", root),
  JSON.stringify(
    {
      lastUpdated: metadata.lastUpdated,
      items: accessories.map(({ skin, ...item }) => item),
    },
    null,
    2,
  ),
);
console.log(
  `Pinned ${records.length}/${accessories.length} item rules at ${commit}. No market prices stored.`,
);
