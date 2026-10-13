import { z } from "zod";
export const rarities = [
  "COMMON",
  "UNCOMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "MYTHIC",
  "DIVINE",
  "SPECIAL",
  "VERY_SPECIAL",
  "ULTIMATE",
] as const;
export type Rarity = (typeof rarities)[number];
export const rarityMP: Record<Rarity, number> = {
  COMMON: 3,
  UNCOMMON: 5,
  RARE: 8,
  EPIC: 12,
  LEGENDARY: 16,
  MYTHIC: 22,
  DIVINE: 28,
  SPECIAL: 3,
  VERY_SPECIAL: 5,
  ULTIMATE: 1,
};
export const nextRarity: Partial<Record<Rarity, Rarity>> = {
  COMMON: "UNCOMMON",
  UNCOMMON: "RARE",
  RARE: "EPIC",
  EPIC: "LEGENDARY",
  LEGENDARY: "MYTHIC",
  MYTHIC: "DIVINE",
  SPECIAL: "VERY_SPECIAL",
};
export interface Item {
  id: string;
  name: string;
  rarity: Rarity;
  family: string;
  tier: number;
  recombEligible: boolean;
  soulbound: boolean;
  requirements: string[];
  mpMultiplier?: number;
  mpOverride?: number;
  conditional?: string;
  icon?: string;
}
export interface Owned {
  id: string;
  rarity: Rarity;
  recomb: boolean;
  soulbound: boolean;
  active: boolean;
  mpOverride?: number;
  instance?: string;
}
export interface Recipe {
  from?: string;
  to: string;
  materials: Record<string, number>;
  fee: number;
  requirements: string[];
  preserveRecomb: boolean;
  source: string;
}
export interface Offer {
  id: string;
  itemId: string;
  rarity: Rarity;
  recomb: boolean;
  price: number;
  end: number;
  updatedAt: number;
  variant: string;
}
export interface Book {
  sell_summary: { amount: number; pricePerUnit: number }[];
  buy_summary: { amount: number; pricePerUnit: number }[];
}
export interface Market {
  books: Record<string, Book>;
  offers: Offer[];
  bazaarUpdatedAt: number | null;
  auctionsUpdatedAt: number | null;
  warnings: string[];
  stale: boolean;
}
export interface Resource {
  id: string;
  quantity: number;
  name: string;
  source: "bazaar" | "auction" | "manual";
  offerId?: string;
  manualUnit?: number;
}
export interface Step {
  itemId: string;
  name: string;
  type: "buy" | "craft" | "upgrade" | "recomb" | "equip" | "unequip" | "slots";
  fromRarity?: Rarity;
  rarity?: Rarity;
  cost: number;
  gain: number;
  resources: Resource[];
  requirements: string[];
  source: string;
  updatedAt: number | null;
  auctionId?: string;
  cumulativeMP?: number;
  cumulativeCost?: number;
}
export interface Option {
  family: string;
  gain: number;
  slots: number;
  steps: Step[];
}
export interface Settings {
  mode: "target" | "budget";
  target: number;
  budget: number;
  capacity: number;
  slotBatch: number;
  slotCost: number;
  slotSchedule: number[];
  maxExpansions: number;
  recomb: boolean;
  craft: boolean;
  auction: boolean;
  buyOrders: boolean;
  allowGated: boolean;
  confirmedRequirements: string[];
  excluded: string[];
  maxStates: number;
  bazaarFee: number;
  recombFee: number;
  preferSlots: boolean;
  keepDuplicates: boolean;
}
export interface Plan {
  name: string;
  status: "exact" | "approximate";
  feasible: boolean;
  currentMP: number;
  finalMP: number;
  cost: number;
  gain: number;
  slotsUnlocked: number;
  recombs: number;
  remainingBudget: number;
  steps: Step[];
  shopping: Resource[];
  warnings: string[];
  states: number;
}
export const ownedSchema = z.object({
  id: z.string().min(1).max(100),
  rarity: z.enum(rarities),
  recomb: z.boolean(),
  soulbound: z.boolean(),
  active: z.boolean(),
  mpOverride: z.number().int().min(0).max(200).optional(),
});
export const settingsSchema = z.object({
  mode: z.enum(["target", "budget"]),
  target: z.number().int().min(0).max(10000),
  budget: z.number().min(0).max(1e15),
  capacity: z.number().int().min(0).max(1000),
  slotBatch: z.number().int().min(1).max(100),
  slotCost: z.number().min(0).max(1e12),
  slotSchedule: z.array(z.number().min(0).max(1e12)).max(500),
  maxExpansions: z.number().int().min(0).max(500),
  recomb: z.boolean(),
  craft: z.boolean(),
  auction: z.boolean(),
  buyOrders: z.boolean(),
  allowGated: z.boolean(),
  confirmedRequirements: z.array(z.string().max(200)).max(1000),
  excluded: z.array(z.string()).max(1000),
  maxStates: z.number().int().min(100).max(60000),
  bazaarFee: z.number().min(0).max(0.5),
  recombFee: z.number().min(0).max(1e10),
  preferSlots: z.boolean(),
  keepDuplicates: z.boolean().default(false),
});
export const defaultSettings: Settings = {
  mode: "target",
  target: 100,
  budget: 100_000_000,
  capacity: 30,
  slotBatch: 2,
  slotCost: 12_000_000,
  slotSchedule: [],
  maxExpansions: 20,
  recomb: true,
  craft: true,
  auction: true,
  buyOrders: false,
  allowGated: false,
  confirmedRequirements: [],
  excluded: [],
  maxStates: 60000,
  bazaarFee: 0,
  recombFee: 0,
  preferSlots: false,
  keepDuplicates: false,
};
