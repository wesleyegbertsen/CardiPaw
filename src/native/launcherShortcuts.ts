import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** One pet as the plugin gets it. photo: a data URL, or null for the app icon. */
export interface ShortcutPet {
  id: string;
  shortLabel: string;
  longLabel: string;
  photo: string | null;
}

interface LauncherShortcutsPlugin {
  /** Every pet in home order: the first four become the long-press shortcuts; pins of pets that are gone are disabled. */
  setShortcuts(options: { pets: ShortcutPet[]; disabledMessage: string }): Promise<void>;
  /** A shortcut was tapped; petId comes from an intent, so the listener checks it. */
  addListener(
    event: 'shortcutOpened',
    listener: (event: { petId?: unknown }) => void,
  ): Promise<PluginListenerHandle>;
}

/** App only (android/app/.../LauncherShortcutsPlugin.java): no web implementation. */
export const LauncherShortcuts = registerPlugin<LauncherShortcutsPlugin>('LauncherShortcuts');
