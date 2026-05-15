import { useEffect, useId, useRef } from "react";
import type { UserSettings, ThemeChoice } from "./userSettings";

export type ProfileMenuProps = {
  open: boolean;
  onClose: () => void;
  ui: Record<string, string>;
  settings: UserSettings;
  onSettingsChange: (next: UserSettings) => void;
  onDownloadDemoCredit: () => void | Promise<void>;
  onDownloadDemoBudget: () => void | Promise<void>;
};

function uiText(ui: Record<string, string>, key: string): string {
  const v = ui[key];
  if (typeof v !== "string") throw new Error(`Missing ui string key: ${key}`);
  return v;
}

function HamburgerIcon() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
      <rect x="0" y="0" width="20" height="2" rx="1" fill="currentColor" />
      <rect x="0" y="6" width="20" height="2" rx="1" fill="currentColor" />
      <rect x="0" y="12" width="20" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

export function ProfileMenuTrigger({
  ui,
  expanded,
  onClick,
}: {
  ui: Record<string, string>;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn profile-trigger"
      aria-expanded={expanded}
      aria-controls="profile-drawer"
      aria-label={uiText(ui, "profileMenuAriaLabel")}
      onClick={onClick}
    >
      <span className="profile-trigger-inner">
        <HamburgerIcon />
        <span className="profile-trigger-label">{uiText(ui, "profileMenuShort")}</span>
      </span>
    </button>
  );
}

export function ProfileMenu({
  open,
  onClose,
  ui,
  settings,
  onSettingsChange,
  onDownloadDemoCredit,
  onDownloadDemoBudget,
}: ProfileMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = panelRef.current;
    if (!root) return;
    const focusable = root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || focusable.length === 0) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", trap);
    return () => root.removeEventListener("keydown", trap);
  }, [open]);

  if (!open) return null;

  const setTheme = (theme: ThemeChoice) => onSettingsChange({ ...settings, theme });
  const patch = (partial: Partial<UserSettings>) => onSettingsChange({ ...settings, ...partial });

  return (
    <div className="profile-overlay" role="presentation">
      <button
        type="button"
        className="profile-backdrop"
        aria-label={uiText(ui, "profileBackdropAria")}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        id="profile-drawer"
        className="profile-drawer panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="profile-drawer-header">
          <div>
            <h2 id={titleId} className="profile-drawer-title">
              {uiText(ui, "profileTitle")}
            </h2>
            {settings.displayName.trim() ? (
              <p className="subtle profile-greeting">
                {uiText(ui, "profileGreetingPrefix")} {settings.displayName.trim()}
              </p>
            ) : (
              <p className="subtle">{uiText(ui, "profileLocalOnly")}</p>
            )}
          </div>
          <button ref={closeRef} type="button" className="btn profile-close" onClick={onClose}>
            {uiText(ui, "profileClose")}
          </button>
        </div>

        <section className="profile-section" aria-label={uiText(ui, "settingsSectionProfile")}>
          <h3 className="profile-section-title">{uiText(ui, "settingsSectionProfile")}</h3>
          <label className="profile-field">
            <span>{uiText(ui, "settingsDisplayName")}</span>
            <input
              type="text"
              maxLength={80}
              value={settings.displayName}
              onChange={(e) => patch({ displayName: e.target.value })}
              placeholder={uiText(ui, "settingsDisplayNamePlaceholder")}
              autoComplete="nickname"
            />
          </label>
          <p className="subtle profile-hint">{uiText(ui, "settingsDisplayNameHelp")}</p>
        </section>

        <section className="profile-section" aria-label={uiText(ui, "settingsSectionAppearance")}>
          <h3 className="profile-section-title">{uiText(ui, "settingsSectionAppearance")}</h3>
          <label className="profile-field">
            <span>{uiText(ui, "settingsTheme")}</span>
            <select value={settings.theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)}>
              <option value="system">{uiText(ui, "settingsThemeSystem")}</option>
              <option value="light">{uiText(ui, "settingsThemeLight")}</option>
              <option value="dark">{uiText(ui, "settingsThemeDark")}</option>
            </select>
          </label>
          <label className="profile-toggle">
            <input
              type="checkbox"
              checked={settings.compactLayout}
              onChange={(e) => patch({ compactLayout: e.target.checked })}
            />
            <span>{uiText(ui, "settingsCompactLayout")}</span>
          </label>
          <p className="subtle profile-hint">{uiText(ui, "settingsCompactLayoutHelp")}</p>
        </section>

        <section className="profile-section" aria-label={uiText(ui, "settingsSectionAccessibility")}>
          <h3 className="profile-section-title">{uiText(ui, "settingsSectionAccessibility")}</h3>
          <label className="profile-toggle">
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={(e) => patch({ reducedMotion: e.target.checked })}
            />
            <span>{uiText(ui, "settingsReducedMotion")}</span>
          </label>
          <p className="subtle profile-hint">{uiText(ui, "settingsReducedMotionHelp")}</p>
        </section>

        <section className="profile-section" aria-label={uiText(ui, "settingsSectionLanguage")}>
          <h3 className="profile-section-title">{uiText(ui, "settingsSectionLanguage")}</h3>
          <label className="profile-field">
            <span>{uiText(ui, "settingsLanguage")}</span>
            <select disabled value="en-US">
              <option value="en-US">{uiText(ui, "settingsLanguageEnglish")}</option>
            </select>
          </label>
          <p className="subtle profile-hint">{uiText(ui, "settingsLanguageHelp")}</p>
        </section>

        <section className="profile-section" aria-label={uiText(ui, "settingsSectionNotifications")}>
          <h3 className="profile-section-title">{uiText(ui, "settingsSectionNotifications")}</h3>
          <p className="subtle">{uiText(ui, "settingsNotificationsHelp")}</p>
        </section>

        <section className="profile-section" aria-label={uiText(ui, "settingsSectionPrivacy")}>
          <h3 className="profile-section-title">{uiText(ui, "settingsSectionPrivacy")}</h3>
          <p className="subtle">{uiText(ui, "settingsPrivacyHelp")}</p>
        </section>

        <section className="profile-section" aria-label={uiText(ui, "settingsSectionSamples")}>
          <h3 className="profile-section-title">{uiText(ui, "settingsSectionSamples")}</h3>
          <p className="subtle">{uiText(ui, "settingsSamplesHelp")}</p>
          <div className="profile-sample-actions">
            <button type="button" className="btn btn-primary" onClick={() => void onDownloadDemoCredit()}>
              {uiText(ui, "settingsDownloadDemoCredit")}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void onDownloadDemoBudget()}>
              {uiText(ui, "settingsDownloadDemoBudget")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
