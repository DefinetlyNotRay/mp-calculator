"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownToLine,
  ArrowRight,
  Backpack,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Coins,
  Compass,
  Gem,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  WandSparkles,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import contactData from "../../data/abiphone-contacts.json";
import {
  currentPower,
  effectiveCollection,
  power,
  slotExpansion,
} from "@/lib/domain";
import { coins } from "@/lib/utils";
import { useOptimizerStore } from "@/lib/store";
import {
  Item,
  Owned,
  Plan,
  Rarity,
  Recipe,
  rarities,
  rarityMP,
} from "@/lib/models";
type CatalogData = {
  items: Item[];
  recipes: Recipe[];
  coverage: {
    items: number;
    rules: number;
    recipes: number;
    commit: string;
    source: string;
  };
  warnings: string[];
};
type MarketData = {
  recombPrice: number | null;
  bazaarUpdatedAt: number | null;
  auctionsUpdatedAt: number | null;
  stale: boolean;
  warnings: string[];
  prices: Record<string, { price: number; id: string; end: number }>;
  contactPrices: Record<string, { price: number | null; source: string }>;
};
type Result = { plans: Plan[]; limitations: string[] };
type Profiles = {
  name: string;
  uuid: string;
  profiles: { id: string; name: string; selected?: boolean; mode: string }[];
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "The request failed.");
  return data;
}
const colors: Record<Rarity, string> = {
  COMMON: "#d1d4dc",
  UNCOMMON: "#81c995",
  RARE: "#7faeff",
  EPIC: "#bb8fea",
  LEGENDARY: "#e8bd68",
  MYTHIC: "#ed9aca",
  DIVINE: "#71d6dd",
  SPECIAL: "#ec8989",
  VERY_SPECIAL: "#ec8989",
  ULTIMATE: "#d3d3d3",
};
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "collection", label: "My accessories", icon: Backpack },
  { id: "explorer", label: "Accessory explorer", icon: Compass },
  { id: "calculator", label: "Manual calculator", icon: Coins },
  { id: "settings", label: "Optimizer settings", icon: Settings2 },
];
function ItemIcon({
  rarity = "EPIC",
  large = false,
}: {
  rarity?: Rarity;
  large?: boolean;
}) {
  return (
    <span
      className={`item-icon ${large ? "large" : ""}`}
      style={{ "--item-color": colors[rarity] } as React.CSSProperties}
      title="Symbolic accessory icon"
    >
      <Gem size={large ? 32 : 20} strokeWidth={1.5} />
    </span>
  );
}
function Stamp({ value }: { value: number | null | undefined }) {
  return (
    <>
      {value
        ? new Date(value).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Not loaded"}
    </>
  );
}
export function Dashboard() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>
  );
}
function Workspace() {
  const store = useOptimizerStore();
  const { owned, settings, manual } = store;
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("overview");
  const [importOpen, setImportOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [planIndex, setPlanIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [recombFilter, setRecombFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [maxPrice, setMaxPrice] = useState("");
  const [addId, setAddId] = useState("");
  const [pendingRarity, setPendingRarity] = useState<Rarity>("COMMON");
  const [editRecomb, setEditRecomb] = useState(false);
  const [editSoulbound, setEditSoulbound] = useState(false);
  const [editActive, setEditActive] = useState(true);
  const [viewCount, setViewCount] = useState(40);
  const [chartMode, setChartMode] = useState("progress");
  useEffect(() => setReady(true), []);
  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<CatalogData>("/api/catalog"),
    staleTime: 86400000,
  });
  const market = useQuery({
    queryKey: ["market", settings.auction],
    queryFn: () => api<MarketData>(`/api/market?auctions=${settings.auction}`),
    staleTime: 60000,
  });
  const items = catalog.data?.items ?? [];
  const mp = currentPower(owned, items);
  const effective = effectiveCollection(owned, items);
  const occupied = owned.filter((x) => x.active).length;
  const free = Math.max(0, settings.capacity - occupied);
  const plan = result?.plans[planIndex];
  const lookup = useMutation({
    mutationFn: () =>
      api<Profiles>(
        `/api/profiles?player=${encodeURIComponent(username.trim())}`,
      ),
    onSuccess: (data) => {
      setProfiles(data);
      setSelectedProfile(
        data.profiles.find((p) => p.selected)?.id ?? data.profiles[0]?.id ?? "",
      );
    },
    onError: (e) => setNotice(e.message),
  });
  const importPlayer = useMutation({
    mutationFn: () =>
      api<{
        owned: Owned[];
        capacity: number | null;
        slotUpgradesPurchased: number | null;
        slotPricing: {
          slotBatch: number;
          slotSchedule: number[];
          slotCost: number;
          maxExpansions: number;
        } | null;
        abiphone: {
          activeContacts: string[];
          phoneName: string | null;
          baseCapacity: number;
        };
        warnings: string[];
        incomplete: boolean;
        gameMode: string;
      }>(`/api/profiles?uuid=${profiles!.uuid}&profile=${selectedProfile}`),
    onSuccess: (data) => {
      store.setOwned(data.owned);
      store.setImportStatus(data.incomplete, data.warnings);
      if (data.capacity !== null)
        store.setSettings({ capacity: data.capacity });
      if (data.slotPricing) store.setSettings(data.slotPricing);
      store.setSettings({
        activeContacts: data.abiphone.activeContacts.length,
        activeContactIds: data.abiphone.activeContacts,
        contactBaseCapacity: data.abiphone.baseCapacity,
      });
      if (data.gameMode === "ironman" || data.gameMode === "bingo")
        store.setSettings({ auction: false });
      store.setProfile(
        profiles!.name,
        profiles!.profiles.find((p) => p.id === selectedProfile)?.name ??
          "SkyBlock profile",
      );
      setNotice(
        data.warnings.join(" ") ||
          "Collection imported. Confirm bag capacity before optimizing.",
      );
      setResult(null);
      setImportOpen(false);
    },
    onError: (e) => setNotice(e.message),
  });
  const fingerprint = JSON.stringify({ owned, settings, manual });
  const currentFingerprint = useRef(fingerprint);
  currentFingerprint.current = fingerprint;
  const hasOptimized = useRef(false);
  const optimizer = useMutation({
    mutationFn: async () => {
      hasOptimized.current = true;
      const requested = fingerprint;
      const data = await api<Result>("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owned, settings, manual }),
      });
      return { data, requested };
    },
    onSuccess: ({ data, requested }) => {
      if (requested !== currentFingerprint.current) return;
      setResult(data);
      setPlanIndex(0);
    },
    onError: (e) => setNotice(e.message),
  });
  const lastFingerprint = useRef(fingerprint);
  useEffect(() => {
    if (fingerprint === lastFingerprint.current) return;
    lastFingerprint.current = fingerprint;
    if (!hasOptimized.current) return;
    setResult(null);
    const timer = setTimeout(() => optimizer.mutate(), 800);
    return () => clearTimeout(timer);
  }, [fingerprint]); // Recompute a previously requested plan when inputs change.
  const priceOf = (item: Item) =>
    manual[item.id] ??
    market.data?.prices[`${item.id}:${item.rarity}:false`]?.price;
  const rows = useMemo(
    () =>
      items
        .filter(
          (i) =>
            i.name.toLowerCase().includes(search.toLowerCase()) ||
            i.id.toLowerCase().includes(search.toLowerCase()),
        )
        .filter((i) => rarityFilter === "all" || i.rarity === rarityFilter)
        .filter(
          (i) =>
            ownershipFilter === "all" ||
            (ownershipFilter === "owned") === owned.some((o) => o.id === i.id),
        )
        .filter(
          (i) =>
            recombFilter === "all" ||
            (recombFilter === "recomb") ===
              owned.some((o) => o.id === i.id && o.recomb),
        )
        .filter(
          (i) =>
            sourceFilter === "all" ||
            (sourceFilter === "manual"
              ? manual[i.id] !== undefined
              : sourceFilter === "craft"
                ? catalog.data?.recipes.some((r) => r.to === i.id)
                : priceOf(i) !== undefined),
        )
        .filter(
          (i) =>
            !maxPrice ||
            (priceOf(i) !== undefined && priceOf(i)! <= Number(maxPrice)),
        )
        .sort((a, b) =>
          sort === "price"
            ? (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity)
            : sort === "efficiency"
              ? (priceOf(a) ?? Infinity) / power(a, a.rarity) -
                (priceOf(b) ?? Infinity) / power(b, b.rarity)
              : a.name.localeCompare(b.name),
        ),
    [
      items,
      search,
      rarityFilter,
      ownershipFilter,
      recombFilter,
      sourceFilter,
      maxPrice,
      sort,
      owned,
      manual,
      market.data,
      catalog.data,
    ],
  );
  const best = plan?.steps.find((s) => s.type !== "slots");
  const exportPlan = () => {
    if (!plan) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            plan,
            limitations: result?.limitations,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "powerforge-upgrade-plan.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const toggle = (key: "recomb" | "craft" | "auction" | "buyOrders") =>
    store.setSettings({ [key]: !settings[key] });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Powerforge home">
          <span className="brand-mark">
            <Gem size={26} />
          </span>
          <span>
            POWER<span className="gold">FORGE</span>
            <small>SKYBLOCK OPTIMIZER</small>
          </span>
        </a>
        <div className="workspace-tag">
          <span className="live-dot" /> YOUR UPGRADE WORKSPACE
        </div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={`nav-item ${tab === n.id ? "active" : ""}`}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "overview" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <Sparkles size={18} />
            <strong>Every coin counts.</strong>
            <p>
              Better accessories. Smarter paths.
              <br />
              More power for your purse.
            </p>
          </div>
          <a
            className="docs-link"
            href="https://api.hypixel.net/"
            target="_blank"
            rel="noreferrer"
          >
            <BookOpen size={16} /> Hypixel API documentation{" "}
            <ArrowRight size={14} />
          </a>
          <div className="mini-profile">
            <span className="avatar">
              {store.playerName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{store.playerName}</strong>
              <small>{store.profileName}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Import another profile"
              onClick={() => setImportOpen(true)}
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />{" "}
            <span>{nav.find((n) => n.id === tab)?.label}</span>
          </div>
          <div className="topbar-actions">
            <span
              className={`status-pill ${market.data?.stale ? "stale" : ""}`}
            >
              <span className="live-dot" />
              {market.isFetching
                ? "Syncing markets"
                : market.data?.bazaarUpdatedAt
                  ? market.data.stale
                    ? "Cached prices"
                    : "Bazaar connected"
                  : "Markets pending"}
            </span>
            <button
              className="icon-button"
              aria-label="Open help"
              onClick={() =>
                setNotice(
                  "Import a profile or add accessories manually. Confirm bag capacity, set a target and budget, then find a path. Exact means exact within supported, priced routes. Market availability can change.",
                )
              }
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> THE NEXT LEVEL STARTS HERE
              </div>
              <h1>
                {tab === "overview"
                  ? "Make your power go further."
                  : nav.find((n) => n.id === tab)?.label}
              </h1>
              <p>
                {tab === "overview"
                  ? "Your accessories. Live markets. The smartest route to more Magical Power."
                  : "Fine-tune your collection and find the upgrades that matter."}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setNotice("Refresh respects server cache and rate limits.");
                market.refetch();
              }}
              disabled={market.isFetching}
            >
              <RefreshCw
                size={15}
                className={market.isFetching ? "spin" : ""}
              />{" "}
              Refresh prices
            </Button>
          </div>
          {notice && (
            <div className="notice" role="status">
              <CircleHelp size={18} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {(catalog.error || market.error) && (
            <div className="notice error" role="alert">
              {catalog.error?.message ?? market.error?.message}
            </div>
          )}
          {store.incomplete && (
            <div className="notice" role="alert">
              <CircleHelp size={18} />
              <span>
                Import is incomplete. The MP shown is only the known subtotal,
                and a reliable player-specific plan needs your complete
                accessory bag. Add missing accessories under My accessories,
                then confirm the collection is complete.
              </span>
              <button
                className="text-link"
                onClick={() => setTab("collection")}
              >
                Review collection <ArrowRight size={14} />
              </button>
            </div>
          )}
          <section className="profile-strip">
            <div className="profile-label">
              <span className="avatar big">
                <Backpack size={24} />
              </span>
              <div>
                <small>ACTIVE COLLECTION</small>
                <strong>
                  {store.playerName}{" "}
                  <span className="profile-chip">{store.profileName}</span>
                </strong>
              </div>
            </div>
            <div className="profile-meta">
              <span>
                <ShieldCheck size={15} />{" "}
                {owned.length
                  ? "Review collection accuracy"
                  : "Manual mode ready"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setProfiles(null);
                  setImportOpen(true);
                }}
              >
                Import player <ArrowRight size={14} />
              </Button>
            </div>
          </section>
          {!ready || catalog.isLoading ? (
            <div className="stats-grid">
              {[1, 2, 3, 4].map((x) => (
                <div className="stat-card skeleton" key={x} />
              ))}
            </div>
          ) : (
            <section className="stats-grid">
              <Stat
                icon={<Sparkles size={19} />}
                label={
                  store.incomplete
                    ? "KNOWN MAGICAL POWER (PARTIAL)"
                    : "CURRENT MAGICAL POWER"
                }
                value={mp.toLocaleString()}
                unit="MP"
                detail={`${effective.size} active accessory families`}
                color="purple"
              />
              <Stat
                icon={<Target size={19} />}
                label="YOUR TARGET"
                value={settings.target.toLocaleString()}
                unit="MP"
                detail={`${Math.max(0, settings.target - mp)} MP to your next milestone`}
                color="gold"
              />
              <Stat
                icon={<Backpack size={19} />}
                label="ACCESSORY BAG"
                value={`${occupied} / ${settings.capacity}`}
                detail={`${free} slots available · capacity editable`}
                color="blue"
              />
              <Stat
                icon={<Gem size={19} />}
                label="RECOMBOBULATOR 3000"
                value={
                  market.data?.recombPrice !== null &&
                  market.data?.recombPrice !== undefined
                    ? coins(market.data.recombPrice)
                    : "—"
                }
                detail={
                  <>
                    Instant buy · <Stamp value={market.data?.bazaarUpdatedAt} />
                  </>
                }
                color="green"
              />
            </section>
          )}
          {tab === "overview" && (
            <>
              <div className="primary-grid">
                <section className="panel goal-panel">
                  <div className="panel-heading">
                    <span className="section-label">
                      <Target size={17} /> SET YOUR GOAL
                    </span>
                    <span className="micro-label">01 / PLAN</span>
                  </div>
                  <h2>
                    A little more magic.
                    <br />
                    <span className="muted">A lot less guesswork.</span>
                  </h2>
                  <div
                    className="mode-switch"
                    role="group"
                    aria-label="Optimization mode"
                  >
                    <button
                      className={settings.mode === "target" ? "selected" : ""}
                      onClick={() => store.setSettings({ mode: "target" })}
                    >
                      Cheapest path to target
                    </button>
                    <button
                      className={settings.mode === "budget" ? "selected" : ""}
                      onClick={() => store.setSettings({ mode: "budget" })}
                    >
                      Max MP within budget
                    </button>
                  </div>
                  <div className="goal-fields">
                    <label>
                      Target Magical Power
                      <div className="input-unit">
                        <CommaInput
                          value={settings.target}
                          onValue={(value) =>
                            store.setSettings({
                              target: Math.min(
                                10000,
                                Math.max(0, Number(value)),
                              ),
                            })
                          }
                        />
                        <span>MP</span>
                      </div>
                    </label>
                    <label>
                      Coin budget
                      <div className="input-unit">
                        <CommaInput
                          value={settings.budget}
                          onValue={(value) =>
                            store.setSettings({
                              budget: Math.max(0, Number(value)),
                            })
                          }
                        />
                        <span>coins</span>
                      </div>
                    </label>
                  </div>
                  <div className="goal-options">
                    <Toggle
                      label="Recombobulation"
                      checked={settings.recomb}
                      onChange={() => toggle("recomb")}
                    />
                    <Toggle
                      label="Crafting"
                      checked={settings.craft}
                      onChange={() => toggle("craft")}
                    />
                    <Toggle
                      label="Auction House"
                      checked={settings.auction}
                      onChange={() => toggle("auction")}
                    />
                  </div>
                  <Button
                    className="find-button"
                    disabled={
                      optimizer.isPending || !items.length || store.incomplete
                    }
                    onClick={() => {
                      setNotice("");
                      optimizer.mutate();
                    }}
                  >
                    {optimizer.isPending ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <WandSparkles size={18} />
                    )}{" "}
                    {optimizer.isPending
                      ? "Comparing upgrade paths…"
                      : settings.mode === "target"
                        ? "Find cheapest path"
                        : "Maximize my Magical Power"}
                    <ArrowRight size={17} />
                  </Button>
                  <small className="goal-foot">
                    <ShieldCheck size={12} /> Family exclusivity, market depth &
                    slot costs included
                  </small>
                </section>
                <section className="panel next-panel">
                  <div className="panel-heading">
                    <span className="section-label">
                      <TrendingUp size={17} /> YOUR BEST NEXT MOVE
                    </span>
                    <span className="tag-green">
                      {best ? "PATH RECOMMENDATION" : "READY TO DISCOVER"}
                    </span>
                  </div>
                  <div className="crystal-scene" aria-hidden="true">
                    <div className="orbit orbit-one" />
                    <div className="orbit orbit-two" />
                    <div className="pixel-spark p1" />
                    <div className="pixel-spark p2" />
                    <div className="pixel-spark p3" />
                    <svg viewBox="0 0 180 180" className="crystal">
                      <path
                        d="M90 12 151 52 144 123 90 165 35 124 29 53Z"
                        fill="#8361bd"
                        stroke="#d2b5ff"
                        strokeWidth="2"
                      />
                      <path
                        d="M90 12 78 65 29 53M151 52 112 69 90 12M78 65 90 165 112 69M35 124 78 65 112 69 144 123"
                        fill="none"
                        stroke="#e1c7ff"
                        strokeWidth="2"
                      />
                      <path d="M90 12 78 65 112 69Z" fill="#d2b6ee" />
                      <path d="M29 53 78 65 35 124Z" fill="#b094db" />
                      <path d="M78 65 112 69 90 165Z" fill="#6e43a3" />
                      <path d="M151 52 112 69 144 123Z" fill="#512b81" />
                    </svg>
                    <span className="scene-label">UNLOCK YOUR POTENTIAL</span>
                  </div>
                  <div className="next-details">
                    <h3>{best?.name ?? "Your next upgrade awaits."}</h3>
                    <p>
                      {best
                        ? `${best.type === "recomb" ? "Increase rarity with a Recombobulator" : best.type === "craft" ? "Craft through a supported recipe" : "Acquire and equip this accessory"} as part of the selected complete path.`
                        : "Load your accessories and set a goal. We’ll compare buying, crafting, upgrading, and recombobulating."}
                    </p>
                    {best && (
                      <div className="next-metrics">
                        <span>
                          <strong className="green">+{best.gain} MP</strong>
                          Power gained
                        </span>
                        <span>
                          <strong>{coins(best.cost)}</strong>Estimated coins
                        </span>
                        <span>
                          <strong>
                            {best.gain > 0
                              ? coins(best.cost / best.gain)
                              : "Prerequisite"}
                          </strong>
                          Coins per MP
                        </span>
                      </div>
                    )}
                    <button
                      className="text-link"
                      onClick={() =>
                        best
                          ? document
                              .getElementById("upgrade-path")
                              ?.scrollIntoView({ behavior: "smooth" })
                          : setTab("collection")
                      }
                    >
                      {best
                        ? "See the complete upgrade path"
                        : "Build your accessory collection"}{" "}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
              </div>
              <div className="section-title" id="upgrade-path">
                <div>
                  <span className="eyebrow">02 / OPTIMIZE</span>
                  <h2>Your upgrade path</h2>
                  <p>Every step accounted for. Every coin with a purpose.</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportPlan}
                  disabled={!plan}
                >
                  <ArrowDownToLine size={14} /> Export plan
                </Button>
              </div>
              {optimizer.isPending ? (
                <div className="panel loading-plan">
                  <LoaderCircle className="spin" />
                  <h3>Finding the best combination</h3>
                  <p>
                    Comparing family routes, shared materials, and bag
                    expansions.
                  </p>
                </div>
              ) : !plan ? (
                <section className="panel empty-plan">
                  <span className="empty-icon">
                    <Compass size={28} />
                  </span>
                  <h3>A clear path to your next milestone.</h3>
                  <p>
                    Your optimized plan will appear here, with an ordered
                    shopping list,
                    <br />
                    live price sources, and alternative routes.
                  </p>
                  <div className="empty-features">
                    <span>
                      <Check size={13} /> No duplicate MP
                    </span>
                    <span>
                      <Check size={13} /> Whole slot batches
                    </span>
                    <span>
                      <Check size={13} /> Real market prices
                    </span>
                  </div>
                </section>
              ) : (
                <>
                  <div className="alternatives">
                    {result!.plans.map((p, i) => (
                      <button
                        key={p.name}
                        className={`alternative ${planIndex === i ? "selected" : ""}`}
                        onClick={() => setPlanIndex(i)}
                      >
                        <div>
                          <strong>{p.name}</strong>
                          <span className={p.feasible ? "green" : "muted"}>
                            {p.feasible ? "Target feasible" : "Best reachable"}
                          </span>
                        </div>
                        <span className="alt-cost">
                          {coins(p.cost)} <small>coins</small>
                        </span>
                        <small>
                          {p.finalMP} MP · {p.slotsUnlocked} new slots ·{" "}
                          {p.status === "exact"
                            ? "Exact within model"
                            : "Approximate"}
                        </small>
                      </button>
                    ))}
                  </div>
                  <div className="plan-summary">
                    <span>
                      FINAL POWER{" "}
                      <strong>
                        {plan.finalMP} <small>MP</small>
                      </strong>
                    </span>
                    <span>
                      TOTAL COST{" "}
                      <strong>
                        {coins(plan.cost)} <small>coins</small>
                      </strong>
                    </span>
                    <span>
                      POWER GAINED{" "}
                      <strong className="green">
                        +{plan.gain} <small>MP</small>
                      </strong>
                    </span>
                    <span>
                      AVERAGE COST{" "}
                      <strong>
                        {plan.gain ? coins(plan.cost / plan.gain) : "—"}{" "}
                        <small>/ MP</small>
                      </strong>
                    </span>
                    <span>
                      BUDGET LEFT <strong>{coins(plan.remainingBudget)}</strong>
                    </span>
                  </div>
                  <div className="panel table-panel">
                    <div className="panel-heading">
                      <span className="section-label">
                        <ShieldCheck size={16} />
                        {plan.status === "exact"
                          ? "EXACT WITHIN SUPPORTED ROUTES"
                          : "APPROXIMATE SEARCH"}
                      </span>
                      <small>
                        Snapshot estimates · availability may change
                      </small>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>STEP / ACTION</th>
                            <th>PRICE SOURCE</th>
                            <th>COST</th>
                            <th>MP GAIN</th>
                            <th>RUNNING TOTAL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.steps.map((step, i) => (
                            <tr key={i}>
                              <td>
                                <div className="action-cell">
                                  <span className="step-number">
                                    {String(i + 1).padStart(2, "0")}
                                  </span>
                                  <ItemIcon rarity={step.rarity} />
                                  <div>
                                    <strong
                                      style={{
                                        color: step.rarity
                                          ? colors[step.rarity]
                                          : undefined,
                                      }}
                                    >
                                      {step.name}
                                    </strong>
                                    <small>
                                      {step.type}{" "}
                                      {step.fromRarity
                                        ? `${step.fromRarity} → `
                                        : ""}
                                      {step.rarity?.replace("_", " ")}
                                      {step.requirements.length > 0 && (
                                        <span
                                          title={step.requirements.join("; ")}
                                        >
                                          {" · Needs: "}
                                          {step.requirements.join(", ")}
                                        </span>
                                      )}
                                    </small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span className="source-text">
                                  {step.source}
                                </span>
                                <small>
                                  <Stamp value={step.updatedAt} />
                                  {step.auctionId && (
                                    <>
                                      {" "}
                                      ·{" "}
                                      <code>/viewauction {step.auctionId}</code>
                                    </>
                                  )}
                                </small>
                              </td>
                              <td>{coins(step.cost)}</td>
                              <td className="green">+{step.gain}</td>
                              <td>
                                {step.cumulativeMP} MP
                                <small>
                                  {coins(step.cumulativeCost ?? 0)} coins
                                </small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!plan.steps.length && (
                      <p className="inline-empty">
                        {plan.feasible
                          ? "Your current collection already meets this goal."
                          : "No affordable, priced upgrades are available. Review market status and manual prices."}
                      </p>
                    )}
                  </div>
                  <div className="results-grid">
                    <section className="panel chart-panel">
                      <div className="panel-heading">
                        <span className="section-label">
                          <TrendingUp size={16} /> POWER & SPENDING
                        </span>
                        <select
                          aria-label="Chart type"
                          value={chartMode}
                          onChange={(e) => setChartMode(e.target.value)}
                        >
                          <option value="progress">Cumulative progress</option>
                          <option value="methods">Cost by method</option>
                          <option value="efficiency">Coins per MP</option>
                          <option value="alternatives">Path comparison</option>
                          <option value="budget">Budget utilization</option>
                        </select>
                      </div>
                      <div className="chart-wrap">
                        <ResponsiveContainer width="100%" height="100%">
                          {chartMode === "progress" ? (
                            <AreaChart
                              data={[
                                { coins: 0, mp: plan.currentMP },
                                ...plan.steps.map((s) => ({
                                  coins: s.cumulativeCost,
                                  mp: s.cumulativeMP,
                                })),
                              ]}
                            >
                              <defs>
                                <linearGradient
                                  id="area"
                                  x1="0"
                                  y1="0"
                                  x2="0"
                                  y2="1"
                                >
                                  <stop
                                    offset="0"
                                    stopColor="#b78ee9"
                                    stopOpacity={0.35}
                                  />
                                  <stop
                                    offset="1"
                                    stopColor="#b78ee9"
                                    stopOpacity={0}
                                  />
                                </linearGradient>
                              </defs>
                              <CartesianGrid
                                stroke="#2b2d35"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="coins"
                                type="number"
                                tickFormatter={coins}
                                stroke="#80818d"
                                fontSize={11}
                              />
                              <YAxis stroke="#80818d" fontSize={11} />
                              <Tooltip
                                contentStyle={{
                                  background: "#20212a",
                                  borderColor: "#363742",
                                }}
                                labelFormatter={(v) =>
                                  `${coins(Number(v))} coins`
                                }
                              />
                              <Area
                                type="stepAfter"
                                dataKey="mp"
                                name="Magical Power"
                                stroke="#ba97e7"
                                fill="url(#area)"
                                strokeWidth={2}
                              />
                            </AreaChart>
                          ) : (
                            <BarChart
                              data={
                                chartMode === "alternatives"
                                  ? result!.plans.map((p) => ({
                                      name: p.name,
                                      value: p.cost,
                                    }))
                                  : chartMode === "budget"
                                    ? [
                                        { name: "Spent", value: plan.cost },
                                        {
                                          name: "Remaining",
                                          value: plan.remainingBudget,
                                        },
                                      ]
                                    : chartMode === "efficiency"
                                      ? plan.steps
                                          .filter((s) => s.gain > 0)
                                          .map((s) => ({
                                            name: s.name,
                                            value: s.cost / s.gain,
                                          }))
                                      : Object.entries(
                                          plan.steps.reduce<
                                            Record<string, number>
                                          >((a, s) => {
                                            a[s.type] =
                                              (a[s.type] ?? 0) + s.cost;
                                            return a;
                                          }, {}),
                                        ).map(([name, value]) => ({
                                          name,
                                          value,
                                        }))
                              }
                            >
                              <CartesianGrid
                                stroke="#2b2d35"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="name"
                                stroke="#80818d"
                                fontSize={10}
                              />
                              <YAxis
                                tickFormatter={coins}
                                stroke="#80818d"
                                fontSize={11}
                              />
                              <Tooltip
                                contentStyle={{
                                  background: "#20212a",
                                  borderColor: "#363742",
                                }}
                                formatter={(v) => `${coins(Number(v))} coins`}
                              />
                              <Bar
                                dataKey="value"
                                fill="#d6b675"
                                radius={[4, 4, 0, 0]}
                              />
                            </BarChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    </section>
                    <section className="panel shopping-panel">
                      <div className="panel-heading">
                        <span className="section-label">
                          <Backpack size={16} /> SHOPPING LIST
                        </span>
                        <span className="micro-label">
                          {plan.shopping.length} ITEMS
                        </span>
                      </div>
                      <div className="shopping-items">
                        {plan.shopping.map((r, i) => (
                          <div className="shopping-row" key={i}>
                            <span className="quantity">{r.quantity}×</span>
                            <div>
                              <strong>{r.name.replaceAll("_", " ")}</strong>
                              <small>
                                {r.source}
                                {r.offerId && (
                                  <code> · /viewauction {r.offerId}</code>
                                )}
                              </small>
                            </div>
                          </div>
                        ))}
                        {plan.slotsUnlocked > 0 && (
                          <div className="shopping-row">
                            <span className="quantity">
                              +{plan.slotsUnlocked}
                            </span>
                            <div>
                              <strong>Accessory bag slots</strong>
                              <small>Confirm availability in game</small>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="shopping-total">
                        <span>Estimated total</span>
                        <strong>{coins(plan.cost)} coins</strong>
                      </div>
                    </section>
                  </div>
                  <details className="limitations">
                    <summary>Pricing notes & model coverage</summary>
                    {[
                      ...new Set([...plan.warnings, ...result!.limitations]),
                    ].map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </details>
                </>
              )}
              <section className="market-footer">
                <div>
                  <span className="live-dot" />
                  <strong>Market snapshot</strong>
                </div>
                <span>
                  Bazaar <Stamp value={market.data?.bazaarUpdatedAt} />
                </span>
                <span>
                  Auction House <Stamp value={market.data?.auctionsUpdatedAt} />
                </span>
                <span>
                  {catalog.data?.coverage.recipes ?? 0} supported recipes
                </span>
                <button
                  className="text-link"
                  onClick={() => setTab("settings")}
                >
                  Adjust your preferences <SlidersHorizontal size={13} />
                </button>
              </section>
              {market.data?.warnings.length ? (
                <details className="limitations">
                  <summary>
                    Market status ({market.data.warnings.length})
                  </summary>
                  {market.data.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </details>
              ) : null}
            </>
          )}
          {tab === "collection" && (
            <>
              <div className="notice">
                <ShieldCheck size={17} />
                <span>
                  Confirm your full active collection and any conditional MP.{" "}
                  {store.collectionWarnings.join(" ")}
                </span>
                <Toggle
                  label="Collection complete"
                  checked={!store.incomplete}
                  onChange={() =>
                    store.setImportStatus(
                      !store.incomplete,
                      store.collectionWarnings,
                    )
                  }
                />
              </div>
              <section className="panel collection-add">
                <div className="panel-heading">
                  <span className="section-label">
                    <Plus size={17} /> ADD AN ACCESSORY
                  </span>
                  <small>Manual entries are saved in this browser</small>
                </div>
                <div className="manual-fields">
                  <label>
                    Accessory
                    <select
                      value={addId}
                      onChange={(e) => {
                        setAddId(e.target.value);
                        setPendingRarity(
                          items.find((i) => i.id === e.target.value)?.rarity ??
                            "COMMON",
                        );
                        setEditSoulbound(
                          items.find((i) => i.id === e.target.value)
                            ?.soulbound ?? false,
                        );
                      }}
                    >
                      <option value="">Select an accessory</option>
                      {items
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Actual rarity
                    <select
                      value={pendingRarity}
                      onChange={(e) =>
                        setPendingRarity(e.target.value as Rarity)
                      }
                    >
                      {rarities.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <Button
                    disabled={!addId}
                    onClick={() => {
                      store.setOwned([
                        ...owned,
                        {
                          id: addId,
                          rarity: pendingRarity,
                          recomb: editRecomb,
                          soulbound: editSoulbound,
                          active: editActive,
                        },
                      ]);
                      setNotice(
                        "Accessory added. Set its actual rarity and any conditional MP in the table.",
                      );
                    }}
                  >
                    Add accessory <Plus size={15} />
                  </Button>
                </div>
                <div className="goal-options">
                  <Toggle
                    label="Already recombobulated"
                    checked={editRecomb}
                    onChange={() => setEditRecomb(!editRecomb)}
                  />
                  <Toggle
                    label="Soulbound"
                    checked={editSoulbound}
                    onChange={() => setEditSoulbound(!editSoulbound)}
                  />
                  <Toggle
                    label="In accessory bag"
                    checked={editActive}
                    onChange={() => setEditActive(!editActive)}
                  />
                </div>
                <label className="capacity-field">
                  Accessory bag capacity
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={settings.capacity}
                    onChange={(e) =>
                      store.setSettings({
                        capacity: Math.min(
                          1000,
                          Math.max(0, Number(e.target.value)),
                        ),
                      })
                    }
                  />
                  <small>
                    {occupied > settings.capacity
                      ? "Collection exceeds capacity. Increase capacity or deactivate items."
                      : "Imported NBT array length is a capacity estimate; confirm in game."}
                  </small>
                </label>
              </section>
              <section className="panel table-panel">
                <div className="panel-heading">
                  <span className="section-label">
                    <Backpack size={17} /> YOUR COLLECTION
                  </span>
                  <span>
                    {owned.length} items ·{" "}
                    {owned.filter((o) => o.recomb).length} recombobulated
                  </span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>ACCESSORY</th>
                        <th>ACTUAL RARITY</th>
                        <th>RECOMB</th>
                        <th>SOULBOUND</th>
                        <th>IN BAG</th>
                        <th>MP OVERRIDE</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {owned.map((o, i) => {
                        const item = items.find((x) => x.id === o.id);
                        const update = (patch: Partial<Owned>) =>
                          store.setOwned(
                            owned.map((x, j) =>
                              j === i ? { ...x, ...patch } : x,
                            ),
                          );
                        return (
                          <tr key={i}>
                            <td>
                              <div className="action-cell">
                                <ItemIcon rarity={o.rarity} />
                                <div>
                                  <strong style={{ color: colors[o.rarity] }}>
                                    {item?.name ?? o.id}
                                  </strong>
                                  <small>
                                    {effective.get(item?.family ?? "") === o
                                      ? "Active family representative"
                                      : o.active
                                        ? "Suppressed by family tier"
                                        : "Outside bag"}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <select
                                aria-label={`Rarity for ${item?.name}`}
                                value={o.rarity}
                                onChange={(e) =>
                                  update({ rarity: e.target.value as Rarity })
                                }
                              >
                                {rarities.map((r) => (
                                  <option key={r}>{r}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                aria-label={`Recombobulated ${item?.name}`}
                                type="checkbox"
                                checked={o.recomb}
                                onChange={(e) =>
                                  update({ recomb: e.target.checked })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Soulbound ${item?.name}`}
                                type="checkbox"
                                checked={o.soulbound}
                                onChange={(e) =>
                                  update({ soulbound: e.target.checked })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`In bag ${item?.name}`}
                                type="checkbox"
                                checked={o.active}
                                onChange={(e) =>
                                  update({ active: e.target.checked })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`MP override for ${item?.name}`}
                                className="tiny-input"
                                type="number"
                                min="0"
                                max="200"
                                placeholder={
                                  item ? String(power(item, o.rarity)) : "—"
                                }
                                value={o.mpOverride ?? ""}
                                onChange={(e) =>
                                  update({
                                    mpOverride:
                                      e.target.value === ""
                                        ? undefined
                                        : Math.min(
                                            200,
                                            Math.max(0, Number(e.target.value)),
                                          ),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Remove ${item?.name}`}
                                onClick={() =>
                                  store.setOwned(
                                    owned.filter((_, j) => j !== i),
                                  )
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!owned.length && (
                  <p className="inline-empty">
                    Your collection is empty. Import a profile or add your first
                    accessory above.
                  </p>
                )}
              </section>
            </>
          )}
          {tab === "explorer" && (
            <section className="panel explorer">
              <div className="panel-heading">
                <span className="section-label">
                  <Compass size={17} /> ACCESSORY CATALOG
                </span>
                <small>{rows.length} matching accessories</small>
              </div>
              <div className="filters">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search accessories"
                    placeholder="Search accessories or item IDs…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setViewCount(40);
                    }}
                  />
                </div>
                <select
                  aria-label="Rarity filter"
                  value={rarityFilter}
                  onChange={(e) => setRarityFilter(e.target.value)}
                >
                  <option value="all">All rarities</option>
                  {rarities.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <select
                  aria-label="Ownership filter"
                  value={ownershipFilter}
                  onChange={(e) => setOwnershipFilter(e.target.value)}
                >
                  <option value="all">All ownership</option>
                  <option value="owned">Owned</option>
                  <option value="missing">Missing</option>
                </select>
                <select
                  aria-label="Source filter"
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                >
                  <option value="all">All sources</option>
                  <option value="market">Priced market</option>
                  <option value="craft">Craftable</option>
                  <option value="manual">Manual prices</option>
                </select>
                <select
                  aria-label="Recombobulation filter"
                  value={recombFilter}
                  onChange={(e) => setRecombFilter(e.target.value)}
                >
                  <option value="all">All recomb states</option>
                  <option value="recomb">Owned recombobulated</option>
                  <option value="plain">Not recombobulated</option>
                </select>
                <select
                  aria-label="Sort accessories"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="name">Name</option>
                  <option value="price">Lowest price</option>
                  <option value="efficiency">Coins / MP</option>
                </select>
                <CommaInput
                  aria-label="Maximum price"
                  placeholder="Max price"
                  value={maxPrice}
                  onValue={setMaxPrice}
                />
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ACCESSORY</th>
                      <th>MP</th>
                      <th>LIVE BIN</th>
                      <th>MANUAL PRICE</th>
                      <th>FAMILY</th>
                      <th>INCLUDE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, viewCount).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="action-cell">
                            <ItemIcon rarity={item.rarity} />
                            <div>
                              <strong style={{ color: colors[item.rarity] }}>
                                {item.name}
                              </strong>
                              <small>
                                {item.rarity} ·{" "}
                                {owned.some((o) => o.id === item.id)
                                  ? "Owned"
                                  : "Missing"}
                                {item.conditional ? " · Conditional MP" : ""}
                                {item.requirements.length ? " · Gated" : ""}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>{power(item, item.rarity)}</td>
                        <td>
                          {market.data?.prices[
                            `${item.id}:${item.rarity}:false`
                          ]?.end! > Date.now()
                            ? coins(
                                market.data!.prices[
                                  `${item.id}:${item.rarity}:false`
                                ].price,
                              )
                            : "Unpriced"}
                        </td>
                        <td>
                          <CommaInput
                            className="price-input"
                            aria-label={`Manual price for ${item.name}`}
                            placeholder="Override coins"
                            value={manual[item.id] ?? ""}
                            onValue={(value) =>
                              store.setManual(
                                item.id,
                                value === ""
                                  ? undefined
                                  : Math.max(0, Number(value)),
                              )
                            }
                          />
                        </td>
                        <td>
                          <small title={item.requirements.join("; ")}>
                            {item.family.replaceAll("_", " ")}
                          </small>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include ${item.family} family`}
                            checked={!settings.excluded.includes(item.family)}
                            onChange={(e) =>
                              store.setSettings({
                                excluded: e.target.checked
                                  ? settings.excluded.filter(
                                      (f) => f !== item.family,
                                    )
                                  : [...settings.excluded, item.family],
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > viewCount && (
                <Button
                  variant="ghost"
                  onClick={() => setViewCount(viewCount + 80)}
                >
                  Show more accessories <ChevronDown size={15} />
                </Button>
              )}
            </section>
          )}
          {tab === "calculator" && <ManualCalculator free={free} />}
          {tab === "settings" && (
            <section className="panel settings-panel">
              <div className="panel-heading">
                <span className="section-label">
                  <Settings2 size={17} /> OPTIMIZER PREFERENCES
                </span>
                <span className="micro-label">YOUR RULES, YOUR ROUTE</span>
              </div>
              <h3>Acquisition methods</h3>
              <div className="settings-toggles">
                <Toggle
                  label="Include recombobulation"
                  checked={settings.recomb}
                  onChange={() => toggle("recomb")}
                />
                <Toggle
                  label="Include verified crafting routes"
                  checked={settings.craft}
                  onChange={() => toggle("craft")}
                />
                <Toggle
                  label="Include Auction House BIN purchases"
                  checked={settings.auction}
                  onChange={() => toggle("auction")}
                />
                <Toggle
                  label="Use Bazaar buy orders (fulfillment required)"
                  checked={settings.buyOrders}
                  onChange={() => toggle("buyOrders")}
                />
              </div>
              <h3>Accessory bag expansion</h3>
              <p className="muted">
                Jacobus charges 1.5M for upgrade 1, 5M for upgrades 2–5, 8M for
                6–10, 12M for 11–20, and 20M for 21–99. Profile imports start at
                your next unpurchased upgrade automatically.
              </p>
              <div className="settings-toggles">
                <Toggle
                  label="Keep duplicate Personal Deletors and Compactors in the bag"
                  checked={settings.keepDuplicates ?? false}
                  onChange={() =>
                    store.setSettings({
                      keepDuplicates: !(settings.keepDuplicates ?? false),
                    })
                  }
                />
              </div>
              <p className="muted">
                Extra Personal Deletors and Personal Compactors keep occupying
                their current slots. Other duplicate family members are still
                treated as removable.
              </p>
              <div className="manual-fields">
                <label>
                  Slots per batch
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={settings.slotBatch}
                    onChange={(e) =>
                      store.setSettings({
                        slotBatch: Math.max(1, Number(e.target.value)),
                      })
                    }
                  />
                </label>
                <label>
                  Default coins per batch
                  <CommaInput
                    value={settings.slotCost}
                    onValue={(value) =>
                      store.setSettings({
                        slotCost: Math.max(0, Number(value)),
                      })
                    }
                  />
                </label>
                <label>
                  Available expansion batches
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={settings.maxExpansions}
                    onChange={(e) =>
                      store.setSettings({
                        maxExpansions: Math.max(0, Number(e.target.value)),
                      })
                    }
                  />
                </label>
              </div>
              <label className="full-label">
                Marginal batch schedule (comma-separated coins, starting with
                your next purchase)
                <input
                  placeholder="12000000, 14000000, 16000000"
                  defaultValue={settings.slotSchedule.join(", ")}
                  onBlur={(e) => {
                    const values = e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean)
                      .map(Number);
                    if (values.some((x) => !Number.isFinite(x) || x < 0))
                      setNotice(
                        "Slot schedule must contain non-negative numbers.",
                      );
                    else store.setSettings({ slotSchedule: values });
                  }}
                />
              </label>
              <div className="manual-fields">
                <label>
                  Bazaar purchase fee modifier (%)
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.1"
                    value={settings.bazaarFee * 100}
                    onChange={(e) =>
                      store.setSettings({
                        bazaarFee: Math.max(0, Number(e.target.value)) / 100,
                      })
                    }
                  />
                </label>
                <label>
                  Extra fee per recombobulation
                  <CommaInput
                    value={settings.recombFee}
                    onValue={(value) =>
                      store.setSettings({
                        recombFee: Math.max(0, Number(value)),
                      })
                    }
                  />
                </label>
              </div>
              <h3>Progression requirements</h3>
              <p className="muted">
                Crafting routes remain available even when your profile does not
                meet their unlock requirements, since another player can craft
                the item for you. Any requirement is shown directly on the
                recommendation step.
              </p>
              <h3>Abiphone contacts</h3>
              <p className="muted">
                Imported: {settings.activeContacts} active contacts · phone base
                capacity {settings.contactBaseCapacity || "unknown"}. Every two
                added contacts grant +1 Abicase MP. Phone upgrades and live
                Contacts Trio prices are included automatically.
              </p>
              <div className="manual-fields">
                <label>
                  Existing bonus contact slots
                  <CommaInput
                    value={settings.contactBonusSlots}
                    onValue={(value) =>
                      store.setSettings({
                        contactBonusSlots: Math.max(0, Number(value)),
                      })
                    }
                  />
                </label>
              </div>
              <p className="muted">
                Select contacts you can obtain. Enter the value of consumed
                items, coins, or time you want the optimizer to treat as their
                cost. Requirements come from the current wiki contact table.
              </p>
              <div className="requirements contact-planner">
                {contactData.contacts.map((contact) => {
                  const owned = hasContact(
                    contact.npc,
                    settings.activeContactIds ?? [],
                  );
                  const selected = Object.hasOwn(
                    settings.contactEstimates ?? {},
                    contact.npc,
                  );
                  return (
                    <div
                      className={`contact-row${owned ? " contact-row-owned" : ""}`}
                      key={contact.npc}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={owned || selected}
                          disabled={owned}
                          onChange={(event) => {
                            const next = {
                              ...(settings.contactEstimates ?? {}),
                            };
                            if (event.target.checked)
                              next[contact.npc] =
                                market.data?.contactPrices?.[contact.npc]
                                  ?.price ?? 0;
                            else delete next[contact.npc];
                            store.setSettings({
                              contactEstimates: next,
                              contactCosts: [],
                            });
                          }}
                        />
                        <span>
                          <strong>
                            {contact.npc}
                            {owned && <em className="owned-label">Owned</em>}
                          </strong>
                          <small>{contact.requirement}</small>
                          <small>
                            {market.data?.contactPrices?.[contact.npc]
                              ?.price !== null &&
                            market.data?.contactPrices?.[contact.npc]?.price !==
                              undefined
                              ? `${coins(market.data.contactPrices[contact.npc].price!)} · ${market.data.contactPrices[contact.npc].source}`
                              : (market.data?.contactPrices?.[contact.npc]
                                  ?.source ?? "Manual estimate required")}
                          </small>
                        </span>
                      </label>
                      <CommaInput
                        aria-label={`Estimated cost for ${contact.npc}`}
                        placeholder="Estimated coins"
                        disabled={owned}
                        value={
                          owned
                            ? ""
                            : selected
                              ? (settings.contactEstimates ?? {})[contact.npc]
                              : ""
                        }
                        onValue={(value) => {
                          if (!selected) return;
                          store.setSettings({
                            contactEstimates: {
                              ...(settings.contactEstimates ?? {}),
                              [contact.npc]: Math.max(0, Number(value)),
                            },
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <h3>Data coverage</h3>
              <p className="muted">
                {catalog.data?.coverage.items} accessories ·{" "}
                {catalog.data?.coverage.recipes} supported recipes. Families and
                recipes use{" "}
                <a
                  href={catalog.data?.coverage.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  NotEnoughUpdates
                </a>
                , pinned at{" "}
                <code>{catalog.data?.coverage.commit.slice(0, 7)}</code>.
                Unverified carry-over and cross-family recipes are excluded.
                Resale proceeds are conservatively excluded.
              </p>
            </section>
          )}
          <footer className="footer">
            <span>
              <Gem size={12} /> POWERFORGE{" "}
              <span className="footer-separator">/</span> Built for your next
              milestone.
            </span>
            <span>Independent tool · Not affiliated with Hypixel</span>
          </footer>
        </div>
      </main>
      {importOpen && (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <span className="section-label">
                <Backpack size={18} /> PLAYER IMPORT
              </span>
              <button
                autoFocus
                className="icon-button"
                aria-label="Close import dialog"
                onClick={() => setImportOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <h2 id="import-title">Bring your collection.</h2>
            <p className="muted">
              Enter a Minecraft username or UUID, then choose your SkyBlock
              profile. Import replaces the current manual collection.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookup.mutate();
              }}
            >
              <label>
                Minecraft username or UUID
                <input
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your Minecraft username"
                  required
                  maxLength={36}
                />
              </label>
              <Button disabled={lookup.isPending}>
                {lookup.isPending ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Search size={16} />
                )}{" "}
                Find profiles
              </Button>
            </form>
            {lookup.error && (
              <p role="alert" className="error-text">
                {lookup.error.message}
              </p>
            )}
            {profiles && (
              <div className="profile-picker">
                <label>
                  SkyBlock profile
                  <select
                    value={selectedProfile}
                    onChange={(e) => setSelectedProfile(e.target.value)}
                  >
                    {profiles.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.mode}
                      </option>
                    ))}
                  </select>
                </label>
                {!profiles.profiles.length && (
                  <p>No SkyBlock profiles are available for this player.</p>
                )}
                <Button
                  disabled={!selectedProfile || importPlayer.isPending}
                  onClick={() => importPlayer.mutate()}
                >
                  {importPlayer.isPending ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ArrowRight size={16} />
                  )}{" "}
                  Import collection
                </Button>
                {importPlayer.error && (
                  <p className="error-text" role="alert">
                    {importPlayer.error.message}
                  </p>
                )}
              </div>
            )}
            <small className="muted">
              Private inventory data will be flagged. Manual entry is always
              available.
            </small>
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
  unit,
  detail,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  detail: React.ReactNode;
  color: string;
}) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <p>{detail}</p>
    </div>
  );
}
function hasContact(name: string, ids: string[]) {
  const aliases: Record<string, string[]> = {
    Elizabeth: ["community_shop"],
    Jax: ["arrow_forger"],
    "Jotraeline Greatforge": ["drill_fuel_mechanic"],
    "Maddox the Slayer": ["slayer"],
    Mort: ["gatekeeper"],
    Maxwell: ["thaumaturgist"],
    "Tia the Fairy": ["fairy"],
  };
  const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return ids.some(
    (id) => id === normalized || (aliases[name] ?? []).includes(id),
  );
}

function CommaInput({
  value,
  onValue,
  ...props
}: {
  value: number | string;
  onValue: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const formatted =
    value === ""
      ? ""
      : Number(value).toLocaleString("en-US", {
          maximumFractionDigits: 0,
        });
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={formatted}
      onChange={(event) => {
        const raw = event.target.value.replaceAll(",", "").trim();
        if (/^\d*$/.test(raw)) onValue(raw);
      }}
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="toggle-label">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="toggle-track" />
      <span>{label}</span>
    </label>
  );
}
function ManualCalculator({ free }: { free: number }) {
  const { settings } = useOptimizerStore();
  const [from, setFrom] = useState<Rarity>("LEGENDARY");
  const [to, setTo] = useState<Rarity>("MYTHIC");
  const [upgrade, setUpgrade] = useState("");
  const upgradeCost =
    upgrade.trim() && Number.isFinite(Number(upgrade)) ? Number(upgrade) : null;
  const [count, setCount] = useState(1);
  const [buyRarity, setBuyRarity] = useState<Rarity>("RARE");
  const [prices, setPrices] = useState("");
  const parsed = prices
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const valid =
    parsed.length === count &&
    parsed.every((x) => Number.isFinite(x) && x >= 0);
  const slots = slotExpansion(count, free, settings);
  const buyCost =
    valid && slots ? parsed.reduce((n, x) => n + x, 0) + slots.cost : null;
  const gain = rarityMP[to] - rarityMP[from];
  const buyingGain = count * rarityMP[buyRarity];
  return (
    <section className="panel calculator-panel">
      <div className="panel-heading">
        <span className="section-label">
          <Coins size={17} /> SIDE-BY-SIDE MANUAL CALCULATOR
        </span>
        <small>Explicit manual estimates</small>
      </div>
      <div className="calculator-grid">
        <div>
          <h3>Upgrade an existing accessory</h3>
          <div className="manual-fields">
            <label>
              Current rarity
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value as Rarity)}
              >
                {rarities.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              Resulting rarity
              <select
                value={to}
                onChange={(e) => setTo(e.target.value as Rarity)}
              >
                {rarities.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="full-label">
            Total upgrade cost (coins)
            <CommaInput
              value={upgrade}
              placeholder="Enter your upgrade estimate"
              onValue={setUpgrade}
            />
          </label>
          <div className="calculator-result">
            <strong>+{gain} MP</strong>
            <span>
              {gain > 0 && upgradeCost !== null
                ? `${coins(upgradeCost / gain)} coins / MP`
                : gain > 0
                  ? "Enter an upgrade cost"
                  : "Choose a higher resulting rarity"}
            </span>
            <small>No extra bag slot required</small>
          </div>
        </div>
        <div>
          <h3>Buy new accessory families</h3>
          <div className="manual-fields">
            <label>
              New accessories
              <input
                type="number"
                min="1"
                max="100"
                value={count}
                onChange={(e) =>
                  setCount(Math.max(1, Math.min(100, Number(e.target.value))))
                }
              />
            </label>
            <label>
              Rarity per accessory
              <select
                value={buyRarity}
                onChange={(e) => setBuyRarity(e.target.value as Rarity)}
              >
                {rarities.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="full-label">
            Individual purchase prices (comma-separated)
            <input
              placeholder="Enter one price per accessory"
              value={prices}
              onChange={(e) => setPrices(e.target.value)}
            />
          </label>
          <div className="calculator-result">
            <strong>+{buyingGain} MP</strong>
            <span>
              {buyCost !== null
                ? `${coins(buyCost / buyingGain)} coins / MP`
                : `Enter ${count} prices; confirm slot availability`}
            </span>
            <small>
              {slots
                ? `${slots.slots} slots unlocked · ${coins(slots.cost)} coins in whole batches`
                : "Insufficient available slot expansion batches"}
            </small>
          </div>
        </div>
      </div>
      {buyCost !== null && upgradeCost !== null && gain > 0 && (
        <div className="notice">
          <TrendingUp size={17} />
          {upgradeCost / gain <= buyCost / buyingGain
            ? "The existing upgrade"
            : "The new accessories"}{" "}
          has the lower average cost per MP. These routes may give different
          total MP.
        </div>
      )}
      <p className="muted">
        Assumes distinct, active accessory families with ordinary rarity
        contributions. Use the full optimizer for prerequisites and
        item-specific rules.
      </p>
    </section>
  );
}
