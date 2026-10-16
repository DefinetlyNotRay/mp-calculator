import {
  Item,
  Market,
  Option,
  Owned,
  Plan,
  Recipe,
  Resource,
  Settings,
  Step,
  nextRarity,
} from "./models";
import {
  currentPower,
  effectiveCollection,
  power,
  slotExpansion,
} from "./domain";
import { consolidate, lowestOffer, quoteResources } from "./pricing";
export interface BuildResult {
  groups: Option[][];
  warnings: string[];
  complete: boolean;
}
export function buildOptions(
  items: Item[],
  owned: Owned[],
  recipes: Recipe[],
  market: Market,
  s: Settings,
  manual: Record<string, number> = {},
): BuildResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  const active = effectiveCollection(owned, items);
  const families = new Map<string, Item[]>();
  const warnings: string[] = [];
  let complete = true;
  for (const item of items) {
    if (s.excluded.includes(item.family)) continue;
    const arr = families.get(item.family) ?? [];
    arr.push(item);
    families.set(item.family, arr);
  }
  const groups: Option[][] = [];
  for (const [family, members] of families) {
    const existing = active.get(family);
    const baseItem = existing ? byId.get(existing.id) : undefined;
    const baseMP =
      existing && baseItem
        ? power(baseItem, existing.rarity, existing.mpOverride)
        : 0;
    const options: Option[] = [];
    let paths = 0;
    const visit = (
      item: Item,
      rarity: Item["rarity"],
      recomb: boolean,
      steps: Step[],
      seen: Set<string>,
      depth: number,
      offset = 0,
    ) => {
      if (++paths > 1500 || depth > 12) {
        complete = false;
        return;
      }
      const key = `${item.id}:${rarity}:${recomb}`;
      if (seen.has(key)) return;
      const nextSeen = new Set(seen).add(key);
      const mp = power(item, rarity) + offset;
      const gain = mp - baseMP;
      if (gain > 0) {
        const allResources = steps.flatMap((x) => x.resources);
        if (quoteResources(allResources, market, s) !== null)
          options.push({ family, gain, slots: existing ? 0 : 1, steps });
      }
      if (s.recomb && !recomb && item.recombEligible && nextRarity[rarity]) {
        const next = nextRarity[rarity]!;
        const resources: Resource[] = [
          {
            id: "RECOMBOBULATOR_3000",
            name: "Recombobulator 3000",
            quantity: 1,
            source: "bazaar",
          },
        ];
        const price = quoteResources(resources, market, s);
        if (price !== null)
          visit(
            item,
            next,
            true,
            [
              ...steps,
              {
                itemId: item.id,
                name: item.name,
                type: "recomb",
                fromRarity: rarity,
                rarity: next,
                cost: price + s.recombFee,
                gain: power(item, next) - power(item, rarity),
                resources,
                requirements: [],
                source: s.buyOrders ? "Bazaar buy order" : "Bazaar sell offers",
                updatedAt: market.bazaarUpdatedAt,
              },
            ],
            nextSeen,
            depth + 1,
            offset,
          );
      }
      if (s.craft)
        for (const recipe of recipes.filter((r) => r.from === item.id)) {
          const target = byId.get(recipe.to);
          if (!target || target.family !== family) continue;
          if (recomb && !recipe.preserveRecomb) continue;
          const resources: Resource[] = [];
          let unavailable = false;
          for (const [id, quantity] of Object.entries(recipe.materials)) {
            if (manual[id] !== undefined)
              resources.push({
                id,
                name: byId.get(id)?.name ?? id,
                quantity,
                source: "manual",
                manualUnit: manual[id],
              });
            else if (market.books[id])
              resources.push({ id, name: id, quantity, source: "bazaar" });
            else {
              const matches = market.offers
                .filter(
                  (o) => o.itemId === id && !o.recomb && o.end > Date.now(),
                )
                .sort((a, b) => a.price - b.price)
                .slice(0, quantity);
              if (matches.length !== quantity) {
                unavailable = true;
                break;
              }
              resources.push(
                ...matches.map((o) => ({
                  id,
                  name: id,
                  quantity: 1,
                  source: "auction" as const,
                  offerId: o.id,
                })),
              );
            }
          }
          const price = quoteResources(resources, market, s);
          if (unavailable || price === null) continue;
          const next = recomb ? nextRarity[target.rarity] : target.rarity;
          if (!next) continue;
          visit(
            target,
            next,
            recomb,
            [
              ...steps,
              {
                itemId: target.id,
                name: target.name,
                type: "craft",
                fromRarity: rarity,
                rarity: next,
                cost: price + recipe.fee,
                gain: power(target, next) - mp,
                resources,
                requirements: [
                  ...new Set([...recipe.requirements, ...target.requirements]),
                ],
                source: "Verified recipe • " + recipe.source,
                updatedAt: market.bazaarUpdatedAt,
              },
            ],
            nextSeen,
            depth + 1,
          );
        }
    };
    if (existing && baseItem)
      visit(
        baseItem,
        existing.rarity,
        existing.recomb,
        [],
        new Set(),
        0,
        (existing.mpOverride ?? power(baseItem, existing.rarity)) -
          power(baseItem, existing.rarity),
      );
    for (const item of members) {
      if (item.conditional) {
        warnings.push(
          `${item.name}: conditional acquisition paths excluded; set owned contribution manually.`,
        );
        continue;
      }
      for (const o of owned.filter((o) => o.id === item.id && !o.active)) {
        if (baseItem && item.tier < baseItem.tier) continue;
        visit(
          item,
          o.rarity,
          o.recomb,
          [
            {
              itemId: item.id,
              name: item.name,
              type: "equip",
              rarity: o.rarity,
              cost: 0,
              gain: power(item, o.rarity, o.mpOverride) - baseMP,
              resources: [],
              requirements: item.requirements,
              source: "Owned • move to accessory bag",
              updatedAt: null,
            },
          ],
          new Set(),
          0,
          (o.mpOverride ?? power(item, o.rarity)) - power(item, o.rarity),
        );
      }
      for (const recomb of [false, true]) {
        if (recomb && !s.recomb) continue;
        const rarity = recomb ? nextRarity[item.rarity] : item.rarity;
        if (!rarity) continue;
        if (existing && baseItem && item.tier < baseItem.tier) continue;
        const offer =
          s.auction && !item.soulbound
            ? lowestOffer(market, item.id, rarity, recomb)
            : undefined;
        let resources: Resource[] | undefined;
        let source = "";
        let cost = 0;
        if (!recomb && manual[item.id] !== undefined) {
          cost = manual[item.id];
          resources = [
            {
              id: item.id,
              name: item.name,
              quantity: 1,
              source: "manual",
              manualUnit: cost,
            },
          ];
          source = "Manual purchase estimate";
        } else if (offer) {
          cost = offer.price;
          resources = [
            {
              id: item.id,
              name: item.name,
              quantity: 1,
              source: "auction",
              offerId: offer.id,
            },
          ];
          source = "Auction House BIN";
        } else if (!recomb && market.books[item.id]) {
          resources = [
            { id: item.id, name: item.name, quantity: 1, source: "bazaar" },
          ];
          const price = quoteResources(resources, market, s);
          if (price !== null) {
            cost = price;
            source = "Bazaar";
          } else resources = undefined;
        }
        if (resources)
          visit(
            item,
            rarity,
            recomb,
            [
              {
                itemId: item.id,
                name: item.name,
                type: existing ? "upgrade" : "buy",
                fromRarity: existing?.rarity,
                rarity,
                cost,
                gain: power(item, rarity) - baseMP,
                resources,
                requirements: item.requirements,
                source,
                updatedAt: offer?.updatedAt ?? market.bazaarUpdatedAt,
                auctionId: offer?.id,
              },
            ],
            new Set(),
            0,
          );
      }
      if (s.craft)
        for (const r of recipes.filter((r) => r.to === item.id && !r.from)) {
          const resources = Object.entries(r.materials).map(
            ([id, quantity]): Resource =>
              manual[id] !== undefined
                ? {
                    id,
                    name: id,
                    quantity,
                    source: "manual",
                    manualUnit: manual[id],
                  }
                : { id, name: id, quantity, source: "bazaar" },
          );
          const price = quoteResources(resources, market, s);
          if (price !== null)
            visit(
              item,
              item.rarity,
              false,
              [
                {
                  itemId: item.id,
                  name: item.name,
                  type: "craft",
                  rarity: item.rarity,
                  cost: price + r.fee,
                  gain: power(item, item.rarity) - baseMP,
                  resources,
                  requirements: [
                    ...new Set([...r.requirements, ...item.requirements]),
                  ],
                  source: r.source,
                  updatedAt: market.bazaarUpdatedAt,
                },
              ],
              new Set(),
              0,
            );
        }
    }
    // Only identical outcomes AND resource multisets are interchangeable under shared order-book depth.
    const unique = new Map<string, Option>();
    for (const o of options) {
      const signature = JSON.stringify([
        o.gain,
        o.slots,
        consolidate(o.steps.flatMap((x) => x.resources)).sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      ]);
      const old = unique.get(signature);
      if (
        !old ||
        o.steps.reduce((n, x) => n + x.cost, 0) <
          old.steps.reduce((n, x) => n + x.cost, 0)
      )
        unique.set(signature, o);
    }
    if (unique.size) groups.push([...unique.values()]);
  }
  return { groups, warnings: [...new Set(warnings)], complete };
}
interface State {
  gain: number;
  slots: number;
  cost: number;
  options: Option[];
  resources: Resource[];
  fees: number;
}
export function solve(
  groups: Option[][],
  currentMP: number,
  occupied: number,
  market: Market,
  s: Settings,
  name = "Cheapest path",
  complete = true,
): Plan {
  const free = Math.max(0, s.capacity - occupied);
  let states: State[] = [
    { gain: 0, slots: 0, cost: 0, options: [], resources: [], fees: 0 },
  ];
  let exact = complete;
  let visited = 0;
  const useCounts = new Map<string, Set<number>>();
  groups.forEach((g, i) =>
    g.forEach((o) =>
      o.steps
        .flatMap((x) => x.resources)
        .filter((r) => r.source !== "manual")
        .forEach((r) => {
          const k = r.offerId ?? r.id;
          const set = useCounts.get(k) ?? new Set<number>();
          set.add(i);
          useCounts.set(k, set);
        }),
    ),
  );
  const shared = new Set(
    [...useCounts].filter(([, v]) => v.size > 1).map(([k]) => k),
  );
  if (s.mode === "target" && shared.size) exact = false;
  const prices = new Map<Option, { resources: Resource[]; fixed: number }>();
  for (const group of groups)
    for (const o of group) {
      const all = o.steps.flatMap((x) => x.resources),
        resources = all.filter((r) => shared.has(r.offerId ?? r.id));
      const sharedCost = quoteResources(resources, market, s);
      const totalCost = quoteResources(all, market, s);
      const fees = o.steps.reduce(
        (n, x) =>
          n + x.cost - (quoteResources(x.resources, market, s) ?? x.cost),
        0,
      );
      if (sharedCost !== null && totalCost !== null)
        prices.set(o, { resources, fixed: totalCost - sharedCost + fees });
    }
  const optionCost = (option: Option) => {
    const price = prices.get(option);
    if (!price) return Infinity;
    const quote = quoteResources(price.resources, market, s);
    return quote === null ? Infinity : price.fixed + quote;
  };
  // Families are independent, so processing the cheapest MP first is safe and
  // gives a capped beam useful complete routes before costly families can fill
  // it with inferior combinations.
  groups = [...groups].sort((a, b) => {
    const score = (group: Option[]) =>
      Math.min(
        ...group
          .filter((option) => option.gain > 0)
          .map((option) => optionCost(option) / option.gain),
      );
    return score(a) - score(b);
  });
  const needed = Math.max(0, s.target - currentMP);
  let searchBudget = s.budget;
  if (s.mode === "target" && needed > 0) {
    const remaining = new Set(groups.map((_, index) => index));
    let greedyGain = 0;
    let greedySlots = 0;
    let greedyFixed = 0;
    let greedyResources: Resource[] = [];
    let greedyCost = 0;
    while (greedyGain < needed && remaining.size) {
      let choice:
        | {
            group: number;
            option: Option;
            slots: number;
            fixed: number;
            resources: Resource[];
            cost: number;
            score: number;
          }
        | undefined;
      for (const group of remaining)
        for (const option of groups[group]) {
          if (option.gain <= 0) continue;
          const price = prices.get(option);
          if (!price) continue;
          const slots = greedySlots + option.slots;
          const expansion = slotExpansion(slots, free, s);
          if (!expansion) continue;
          const resources = consolidate([
            ...greedyResources,
            ...price.resources,
          ]);
          const quote = quoteResources(resources, market, s);
          if (quote === null) continue;
          const fixed = greedyFixed + price.fixed;
          const cost = fixed + quote + expansion.cost;
          const usefulGain = Math.min(option.gain, needed - greedyGain);
          const score = (cost - greedyCost) / Math.max(1, usefulGain);
          if (
            !choice ||
            score < choice.score ||
            (score === choice.score && cost < choice.cost)
          )
            choice = {
              group,
              option,
              slots,
              fixed,
              resources,
              cost,
              score,
            };
        }
      if (!choice) break;
      remaining.delete(choice.group);
      greedyGain += choice.option.gain;
      greedySlots = choice.slots;
      greedyFixed = choice.fixed;
      greedyResources = choice.resources;
      greedyCost = choice.cost;
    }
    if (greedyGain >= needed && greedyCost <= s.budget)
      searchBudget = greedyCost;
  }
  for (const group of groups) {
    const next = new Map<string, State>();
    for (const state of states)
      for (const option of [undefined, ...group]) {
        visited++;
        const gain = state.gain + (option?.gain ?? 0),
          slots = state.slots + (option?.slots ?? 0);
        const expansion = slotExpansion(slots, free, s);
        if (!expansion) continue;
        const price = option ? prices.get(option) : undefined;
        if (option && !price) continue;
        const resources = price
          ? consolidate([...state.resources, ...price.resources])
          : state.resources;
        const quote = quoteResources(resources, market, s);
        if (quote === null) continue;
        const before = quoteResources(state.resources, market, s) ?? 0;
        const beforeExpansion = slotExpansion(state.slots, free, s)!.cost;
        const cost =
          state.cost -
          beforeExpansion +
          (price?.fixed ?? 0) +
          quote -
          before +
          expansion.cost;
        // A feasible greedy route gives target mode a safe upper bound: any
        // state above it cannot improve the cheapest result.
        if (cost > searchBudget) continue;
        const usage = resources
          .map((r) => `${r.offerId ?? r.id}:${r.quantity}`)
          .sort()
          .join(",");
        const key =
          s.mode === "target"
            ? `${Math.min(gain, needed)}|${slots}`
            : `${gain}|${slots}|${usage}`;
        const old = next.get(key);
        if (!old || cost < old.cost || (cost === old.cost && gain > old.gain))
          next.set(key, {
            gain,
            slots,
            cost,
            resources,
            fees: 0,
            options: option ? [...state.options, option] : state.options,
          });
      }
    states = [...next.values()];
    if (states.length > s.maxStates) {
      exact = false;
      const needed = Math.max(1, s.target - currentMP);
      if (s.mode === "target") {
        const compressed = new Map<string, State>();
        for (const state of states) {
          const key = `${Math.min(state.gain, needed)}|${state.slots}`;
          const old = compressed.get(key);
          if (
            !old ||
            state.cost < old.cost ||
            (state.cost === old.cost && state.gain > old.gain)
          )
            compressed.set(key, state);
        }
        states = [...compressed.values()];
      }
      const ranked = [...states].sort((a, b) =>
        s.mode === "budget"
          ? b.gain - a.gain || a.cost - b.cost
          : (a.gain >= needed ? 0 : 1) - (b.gain >= needed ? 0 : 1) ||
            (a.gain >= needed
              ? a.cost - b.cost
              : a.cost / Math.max(1, a.gain) - b.cost / Math.max(1, b.gain)),
      );
      if (s.mode === "target") {
        // Preserve slot-count frontiers. Paying for bag expansion looks poor
        // before later accessory families fill those slots, so a plain
        // efficiency beam can otherwise discard every expandable route.
        const cheapestBySlots = new Map<number, State>();
        const strongestBySlots = new Map<number, State>();
        for (const state of states) {
          const cheap = cheapestBySlots.get(state.slots);
          if (
            !cheap ||
            state.cost < cheap.cost ||
            (state.cost === cheap.cost && state.gain > cheap.gain)
          )
            cheapestBySlots.set(state.slots, state);
          const strong = strongestBySlots.get(state.slots);
          if (
            !strong ||
            state.gain > strong.gain ||
            (state.gain === strong.gain && state.cost < strong.cost)
          )
            strongestBySlots.set(state.slots, state);
        }
        const kept = new Set<State>([
          ...cheapestBySlots.values(),
          ...strongestBySlots.values(),
        ]);
        const reserve = Math.max(1, Math.ceil(s.maxStates * 0.2));
        const cheapest = [...states]
          .filter((state) => state.gain > 0)
          .sort((a, b) => a.cost - b.cost || b.gain - a.gain)
          .slice(0, reserve);
        for (const state of cheapest) kept.add(state);
        if (kept.size > s.maxStates) {
          states = [...kept]
            .sort(
              (a, b) =>
                (a.gain >= needed ? 0 : 1) - (b.gain >= needed ? 0 : 1) ||
                a.cost - b.cost ||
                b.gain - a.gain,
            )
            .slice(0, s.maxStates);
          continue;
        }
        for (const state of ranked) {
          if (kept.size >= s.maxStates) break;
          kept.add(state);
        }
        states = [...kept];
      } else states = ranked.slice(0, s.maxStates);
    }
  }
  const affordable = states.filter((x) => x.cost <= s.budget);
  const eligible =
    s.mode === "target"
      ? affordable.filter((x) => currentMP + x.gain >= s.target)
      : affordable;
  const feasible = eligible.length > 0;
  const sorted = (feasible ? eligible : affordable).sort((a, b) =>
    s.preferSlots && feasible
      ? slotExpansion(a.slots, free, s)!.slots -
          slotExpansion(b.slots, free, s)!.slots ||
        (s.mode === "budget"
          ? b.gain - a.gain || a.cost - b.cost
          : a.cost - b.cost || b.gain - a.gain)
      : s.mode === "budget" || !feasible
        ? b.gain - a.gain || a.cost - b.cost
        : a.cost - b.cost || b.gain - a.gain,
  );
  const best = sorted[0] ?? {
    gain: 0,
    slots: 0,
    cost: 0,
    resources: [],
    fees: 0,
    options: [],
  };
  const allResources = consolidate(
    best.options.flatMap((o) => o.steps.flatMap((x) => x.resources)),
  );
  const expansion = slotExpansion(best.slots, free, s)!;
  const steps: Step[] = [];
  if (expansion.slots)
    steps.push({
      itemId: "SLOTS",
      name: `Unlock ${expansion.slots} accessory slots`,
      type: "slots",
      cost: expansion.cost,
      gain: 0,
      resources: [],
      requirements: ["Confirm expansion availability in game"],
      source: "Manual slot pricing schedule",
      updatedAt: null,
    });
  let runningResources: Resource[] = [];
  let spent = expansion.cost;
  let mp = currentMP;
  for (const o of best.options)
    for (const step of o.steps) {
      const before = quoteResources(runningResources, market, s) ?? 0;
      runningResources = consolidate([...runningResources, ...step.resources]);
      const after = quoteResources(runningResources, market, s)!;
      const original = quoteResources(step.resources, market, s) ?? step.cost;
      const cost = after - before + step.cost - original;
      spent += cost;
      mp += step.gain;
      steps.push({ ...step, cost, cumulativeMP: mp, cumulativeCost: spent });
    }
  if (steps[0]?.type === "slots") {
    steps[0].cumulativeMP = currentMP;
    steps[0].cumulativeCost = expansion.cost;
  }
  return {
    name,
    status: exact ? "exact" : "approximate",
    feasible,
    currentMP,
    finalMP: currentMP + best.gain,
    cost: best.cost,
    gain: best.gain,
    slotsUnlocked: expansion.slots,
    recombs:
      allResources.find((r) => r.id === "RECOMBOBULATOR_3000")?.quantity ?? 0,
    remainingBudget: s.budget - best.cost,
    steps,
    shopping: allResources,
    warnings: [
      ...market.warnings,
      ...(!feasible
        ? [
            exact
              ? "Target is unreachable within the supported candidates and budget. Showing the highest reachable modeled MP."
              : "No target-reaching plan was found in the capped search. Showing the best plan found; infeasibility is not proven.",
          ]
        : []),
      ...(!exact
        ? ["Search was capped. This result has no global optimality guarantee."]
        : []),
      ...(s.buyOrders
        ? ["Buy orders require fulfillment; costs are estimates."]
        : []),
    ],
    states: visited,
  };
}
export function optimize(
  items: Item[],
  owned: Owned[],
  recipes: Recipe[],
  market: Market,
  s: Settings,
  manual: Record<string, number> = {},
): Plan[] {
  const mp = currentPower(owned, items);
  const active = effectiveCollection(owned, items);
  const representatives = new Set(active.values());
  const duplicates = owned.filter((o) => o.active && !representatives.has(o));
  const retainedDuplicates = s.keepDuplicates
    ? duplicates.filter(
        (o) =>
          o.id.startsWith("PERSONAL_DELETOR_") ||
          o.id.startsWith("PERSONAL_COMPACTOR_"),
      )
    : [];
  const removableDuplicates = duplicates.filter(
    (o) => !retainedDuplicates.includes(o),
  );
  const occupied =
    owned.filter((o) => o.active).length - removableDuplicates.length;
  return [{ ...s }, { ...s, recomb: false }, { ...s, preferSlots: true }].map(
    (settings, index) => {
      const built = buildOptions(
        items,
        owned,
        recipes,
        market,
        settings,
        manual,
      );
      const abicase = [...active.values()].some((owned) =>
        owned.id.startsWith("ABICASE"),
      );
      if (
        abicase &&
        settings.activeContacts > 0 &&
        settings.contactBaseCapacity > 0 &&
        (settings.contactCosts.length ||
          Object.keys(settings.contactEstimates ?? {}).length)
      ) {
        const estimates = Object.values(settings.contactEstimates ?? {});
        const costs = (estimates.length ? estimates : settings.contactCosts)
          .filter(Number.isFinite)
          .sort((a, b) => a - b)
          .slice(0, Math.max(0, 80 - settings.activeContacts));
        const contactOptions: Option[] = [];
        let acquisitionCost = 0;
        for (let added = 1; added <= costs.length; added++) {
          acquisitionCost += costs[added - 1];
          const gain =
            Math.floor((settings.activeContacts + added) / 2) -
            Math.floor(settings.activeContacts / 2);
          if (gain <= 0) continue;
          const needed = settings.activeContacts + added;
          const phones = [
            {
              capacity: settings.contactBaseCapacity,
              cost: 0,
              name: "current phone",
            },
            { capacity: 10, cost: 5_000_000, name: "Abiphone XIII" },
            { capacity: 11, cost: 25_000_000, name: "Abiphone XIV" },
            { capacity: 12, cost: 50_000_000, name: "Abiphone Flip" },
            { capacity: 13, cost: 100_000_000, name: "Abiphone Flip+" },
          ].filter((phone) => phone.capacity >= settings.contactBaseCapacity);
          let best:
            | {
                cost: number;
                phone: string;
                trios: number;
                resources: Resource[];
              }
            | undefined;
          for (const phone of phones) {
            const freeCapacity = phone.capacity + settings.contactBonusSlots;
            const trios = Math.max(0, Math.ceil((needed - freeCapacity) / 3));
            if (trios > 25) continue;
            const resources: Resource[] = trios
              ? [
                  {
                    id: "TRIO_CONTACTS_ADDON",
                    name: "Abiphone Contacts Trio",
                    quantity: trios,
                    source: "bazaar",
                  },
                ]
              : [];
            const trioCost = quoteResources(resources, market, settings);
            if (trioCost === null) continue;
            const cost = acquisitionCost + phone.cost + trioCost;
            if (!best || cost < best.cost)
              best = { cost, phone: phone.name, trios, resources };
          }
          if (!best) continue;
          contactOptions.push({
            family: "__ABIPHONE_CONTACTS__",
            gain,
            slots: 0,
            steps: [
              {
                itemId: "ABIPHONE_CONTACTS",
                name: `Add ${added} Abiphone contact${added === 1 ? "" : "s"}`,
                type: "upgrade",
                cost: best.cost,
                gain,
                resources: best.resources,
                requirements: [
                  `Requires capacity for ${needed} contacts`,
                  `Capacity route: ${best.phone}${best.trios ? ` + ${best.trios} Contacts Trio${best.trios === 1 ? "" : "s"}` : ""}`,
                ],
                source: "Profile contacts • manual marginal contact costs",
                updatedAt: market.bazaarUpdatedAt,
              },
            ],
          });
        }
        if (contactOptions.length) built.groups.push(contactOptions);
      }
      const plan = solve(
        built.groups,
        mp,
        occupied,
        market,
        settings,
        ["Cheapest path", "Without recombobulation", "Fewest new slots"][index],
        built.complete,
      );
      plan.warnings.push(...built.warnings);
      if (removableDuplicates.length && plan.steps.length) {
        plan.steps.unshift(
          ...removableDuplicates.map((o): Step => ({
            itemId: o.id,
            name: `Move ${items.find((i) => i.id === o.id)?.name ?? o.id} out of the bag`,
            type: "unequip",
            rarity: o.rarity,
            cost: 0,
            gain: 0,
            resources: [],
            requirements: [],
            source: "Owned duplicate or suppressed family tier",
            updatedAt: null,
            cumulativeMP: mp,
            cumulativeCost: 0,
          })),
        );
      }
      return plan;
    },
  );
}
