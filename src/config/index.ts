import type { MenuTab, SettingsTab } from "@/types";

export const menuTabs = ["video", "playlist", "queue"] as MenuTab[];
export const settingTabs = ["general", "playlist", "package"] as SettingsTab[];
export const queryConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount: number) => failureCount < 2,
      networkMode: "offlineFirst" as const,
    },
    mutations: {
      networkMode: "offlineFirst" as const,
    },
  },
};
