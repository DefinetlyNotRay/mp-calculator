# Powerforge — Hypixel SkyBlock Magical Power Optimizer

A working Next.js dashboard with server-only Hypixel integration, NBT collection imports, live Bazaar order books, BIN auction ingestion, manual mode, and a discrete optimization engine. Market prices are fetched rather than seeded. An empty collection is shown until a player imports or enters one.

## Run locally

Requires Node.js 22.12+ and npm. Node 24 is recommended.

```powershell
npm ci
Copy-Item .env.example .env.local
# Set HYPIXEL_API_KEY in .env.local. Never use NEXT_PUBLIC_ for this key.
npm run dev
```

Open http://127.0.0.1:3000. If a local key has already been configured, keep the existing `.env.local` instead of replacing it. The server binds to loopback by default.

For durable PostgreSQL caching:

```powershell
docker compose up -d
# Add DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mp_optimizer
# to .env.local; use a separate credential in production.
npm run db:push
```

Prisma CLI reads `.env`, not Next's `.env.local`. Supply DATABASE_URL to the CLI environment, for example:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/mp_optimizer'
npm run db:push
```

Without DATABASE_URL, development uses a process memory cache and explicitly displays that limitation. This checkout has a separate password-protected PostgreSQL 18 cluster configured in `.cache/pgdata`, bound to `127.0.0.1:55432`. Its generated connection credentials are in ignored `.env.local`; the existing database on port 5432 is untouched. Restart this workspace cluster with `npm run db:local` and stop it with `npm run db:local:stop`. Set `POSTGRES_BIN` if your installed PostgreSQL executables are elsewhere. Docker Compose is an alternative setup, not needed for the configured local cluster.

`CacheEntry` persists API snapshots, `ItemMetadata` stores canonical accessories, and `PriceSnapshot` stores the processed BIN index. Production should run one market ingestion owner or add a distributed refresh lock before horizontally scaling; request deduplication currently operates within one Node process.

```powershell
npm test
npm run typecheck
npm run build
npm start
```

## Using the app

1. Import a Minecraft username/UUID and choose a SkyBlock profile, or add accessories under **My accessories**.
2. Confirm actual rarity, recombobulation, soulbound status, whether each item is in the bag, and bag capacity. MP overrides support conditional contributions.
3. Confirm progression requirements under **Optimizer settings**. A known owned item does not automatically prove that a recipe is unlocked.
4. Set target MP and coin budget, choose instant acquisition or buy orders, and calculate a plan.
5. Compare the cheapest route, the route without recombobulation, and the route minimizing slot expansion. Export a plan as JSON or follow its consolidated shopping list. Auction UUIDs are shown as valid in-game `/viewauction` commands; no invented web purchase links are generated.

Accessories, preferences, and manual purchase estimates persist locally in the browser. Importing replaces the current collection. Items outside the bag are recognized as owned but do not contribute to current MP. A free equip action can activate an owned item with enough bag space. The manual comparison calculator also works without a profile or market connection.

## Optimization algorithm

Each accessory family is a mutually exclusive decision group. Family relationships come from a pinned explicit dataset, not name matching. Directed acquisition routes include buying a canonical item/rarity/recomb variant, equipping an inactive owned item, supported crafting edges, and a single eligible recombobulation. The current highest applicable family tier establishes the baseline contribution; duplicates and lower tiers do not stack. Hegemony uses a multiplier, lore-derived exceptional contributions are modeled separately, and conditional items require an owned contribution override.

The engine enumerates supported acyclic family paths, then runs a multiple-choice dynamic program over MP gain, new slots, and shared market resource usage. A no-op is available for every family. Shared materials are repriced from the aggregate sell-offer book; insufficient depth invalidates a state. The same auction UUID cannot be consumed twice. Buy-order quotes are explicitly estimates at the current best order plus 0.1 coins and carry no fulfillment guarantee. Instant buy quotes sort sell offers ascending and consume depth. Purchase fee modifiers default to zero.

Every state includes the marginal cost of **whole** bag expansion batches. The default follows Jacobus's +2-slot ladder: 1.5M for upgrade 1, 5M for 2–5, 8M for 6–10, 12M for 11–20, and 20M for 21–99. Profile imports start after `bag_upgrades_purchased`; the marginal schedule and availability remain editable. Upgrading/recombobulating an active family uses no new slot. Soulbound resale proceeds are never assumed.

Target mode minimizes total spending subject to budget and target, preferring higher MP at equal cost. Budget mode maximizes MP, preferring lower cost at equal gain. Target-mode states beyond the target can share a key while retaining the lowest cost and highest equal-cost contribution. States are only merged when their slot and shared-resource constraints agree. Small uncapped runs are **exact within the supported priced model**. Larger runs retain a bounded beam and are visibly **approximate**. `MAX_OPTIMIZER_STATES` controls the server ceiling (default 8000). Per-family path count and depth also have explicit bounds. Exhaustive deterministic tests verify uncapped cases against all combinations. An infeasible result shows the highest reachable modeled MP rather than fabricating a path.

## API and cache behavior

Official schema reference: [Hypixel Public API](https://api.hypixel.net/) and [Developer Dashboard](https://developer.hypixel.net/).

- `/v2/resources/skyblock/items`: live canonical item metadata, eligibility, rarity and progression requirements.
- `/v2/skyblock/bazaar`: live sell-offer depth and buy-order quotes, including RECOMBOBULATOR_3000.
- `/v2/skyblock/auctions?page=N`: one shared paginated snapshot, three concurrent page workers, atomic publication only after all pages have matching `lastUpdated` and page count.
- `/v2/skyblock/profiles?uuid=UUID` and `/v2/skyblock/profile?profile=UUID`: authenticated profile selection/import. Mojang resolves usernames.

NBT is decoded only on the server with gzip output bounds. Auction IDs come from `ExtraAttributes.id`; rarity and recombination use lore/attributes rather than display names. Expired, claimed, non-BIN, soulbound, conditional, attribute-bearing, or enriched offers are excluded. The lowest valid matching offer is used, not starting bids on non-BIN auctions.

Refresh buttons respect configurable TTLs, concurrent request deduplication, and upstream rate limit headers. Errors distinguish forbidden keys, throttling and unavailable data. Refresh failures retain the last successful snapshot with an explicit stale status and timestamp. Expired auctions are still removed from stale data. No market data means no priced route unless a user supplies an explicit manual override.

## Current coverage and boundaries

The checkout contains 432 accessory metadata entries, 415 item lore/recipe records, and 177 supported recipes at the initial sync. These counts can change on resync. The UI reports coverage. This tool is usable, but **does not yet cover every SkyBlock acquisition path**:

- The official wiki closed in July 2026; item families/recipes come from the maintained [NotEnoughUpdates data repository](https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO), pinned to the commit in `data/rules.json`. Live metadata still comes from Hypixel. The sync script saves item/rule data only, never prices. Run `npm run data:sync` to refresh deliberately, then review recipe/rule changes.
- Cross-family recipes are excluded because they need a richer prerequisite ownership model. Repeated-accessory recipes consume one predecessor and quote additional copies independently; surplus owned copies are not automatically credited. Unsupported Auction House crafting materials are unpriced.
- Crafting from a recombobulated predecessor is conservatively excluded unless an individual rule verifies carry-over. Buying a final recombobulated BIN or crafting normally then recombobulating are supported.
- Conditional variants are excluded from automatic acquisition until their MP can be proven. Owned contributions can be entered manually. Dynamic rarity upgrades also require actual owned rarity or a matching BIN; quest-based progression is not invented.
- Progression/quest, soulbound and NPC-only acquisition costs need explicit manual estimates; unmet requirements must be confirmed. Irreplaceable progression effort is not converted to fabricated coin prices.
- Resale is excluded because lowest BIN sell offers do not prove an immediately realizable sale. This avoids negative-cost or soulbound resale assumptions.
- Imported NBT bag array length is a capacity estimate requiring confirmation. `highest_magical_power` is only a historical comparison, not current MP. Privacy and decoding gaps remain visible.
- Nonstandard rules/family exceptions beyond this pinned dataset need review. “Exact” is not a claim of global optimality over all of SkyBlock.
- UI item gems are symbolic accessory icons; custom Minecraft item textures are not bundled.

## Project structure

- `src/lib`: independently testable models, MP rules, order-book quotes, optimizer, client state.
- `src/server`: server-only API client, cache/Prisma access, catalog, NBT, market ingestion, collection import.
- `src/app/api`: Zod-validated route handlers, same-origin checks, basic per-process request throttling.
- `src/components`: responsive dashboard, shadcn-style button, Recharts views and manual controls.
- `data`: pinned verifiable mechanics records and item metadata, without market prices.
- `tests`: deterministic domain/optimizer tests and mocked API/cache/NBT integration tests.

Before public deployment, provision PostgreSQL, set runtime secrets, add deployment-level authentication/abuse controls and a distributed refresh owner if using multiple processes. Use the lockfile with `npm ci`. The API key never enters the client store, API JSON, frontend source, or tracked environment files.

## Bazaar field terminology

The brief reverses the actual Hypixel response book names. The official API sample and live data show the player instant-buy ask book in `buy_summary` (ascending prices) and instant-sell bid book in `sell_summary` (descending prices). The implementation consumes `buy_summary` for instant buying and estimates buy orders against the highest `sell_summary` bid. This avoids interpreting a low buy order as an immediately purchasable offer. See the [official Bazaar documentation](https://api.hypixel.net/) and its response sample.
