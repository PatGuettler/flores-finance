export type ThemeChoice = "light" | "dark" | "system";

export type UserSettings = {
  theme: ThemeChoice;
  compactLayout: boolean;
  displayName: string;
  reducedMotion: boolean;
};

export const USER_SETTINGS_STORAGE_KEY = "spend-budget-user-settings";

const defaults: UserSettings = {
  theme: "dark",
  compactLayout: false,
  displayName: "",
  reducedMotion: false,
};

function coerceTheme(v: unknown): ThemeChoice {
  return v === "light" || v === "dark" || v === "system" ? v : defaults.theme;
}

export function loadUserSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(USER_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      theme: coerceTheme(parsed.theme),
      compactLayout: typeof parsed.compactLayout === "boolean" ? parsed.compactLayout : defaults.compactLayout,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : defaults.displayName,
      reducedMotion:
        typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : defaults.reducedMotion,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveUserSettings(s: UserSettings): void {
  localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(s));
}

export function effectiveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return choice === "light" ? "light" : "dark";
}

export function applyUserSettingsToDocument(s: UserSettings): void {
  document.documentElement.dataset.theme = effectiveTheme(s.theme);
  document.documentElement.classList.toggle("reduce-motion", s.reducedMotion);
  document.getElementById("root")?.classList.toggle("compact", s.compactLayout);
}
