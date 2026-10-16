"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultSettings, Owned, Settings } from "./models";
interface State {
  owned: Owned[];
  settings: Settings;
  manual: Record<string, number>;
  profileName: string;
  playerName: string;
  incomplete: boolean;
  collectionWarnings: string[];
  setImportStatus: (incomplete: boolean, warnings: string[]) => void;
  setOwned: (o: Owned[]) => void;
  setSettings: (s: Partial<Settings>) => void;
  setManual: (id: string, value: number | undefined) => void;
  setProfile: (player: string, profile: string) => void;
  reset: () => void;
}
export const useOptimizerStore = create<State>()(
  persist(
    (set) => ({
      owned: [],
      settings: defaultSettings,
      manual: {},
      profileName: "Manual collection",
      playerName: "Your profile",
      incomplete: false,
      collectionWarnings: [],
      setImportStatus: (incomplete, collectionWarnings) =>
        set({ incomplete, collectionWarnings }),
      setOwned: (owned) => set({ owned }),
      setSettings: (s) =>
        set((state) => ({ settings: { ...state.settings, ...s } })),
      setManual: (id, value) =>
        set((state) => {
          const manual = { ...state.manual };
          if (value === undefined) delete manual[id];
          else manual[id] = value;
          return { manual };
        }),
      setProfile: (playerName, profileName) => set({ playerName, profileName }),
      reset: () =>
        set({
          owned: [],
          settings: defaultSettings,
          manual: {},
          playerName: "Your profile",
          profileName: "Manual collection",
          incomplete: false,
          collectionWarnings: [],
        }),
    }),
    {
      name: "skyblock-optimizer-v1",
      version: 2,
      migrate: (persisted) => persisted as State,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<State>;
        return {
          ...current,
          ...saved,
          settings: {
            ...defaultSettings,
            ...(saved.settings ?? {}),
          },
        };
      },
    },
  ),
);
