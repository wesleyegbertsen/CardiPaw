import { registerPlugin } from '@capacitor/core';

interface NotificationSettingsPlugin {
  /** Opens CardiPaw's notification settings, else its app info screen. */
  open(): Promise<void>;
}

/** App only (android/app/.../NotificationSettingsPlugin.java): no web implementation. */
export const NotificationSettings =
  registerPlugin<NotificationSettingsPlugin>('NotificationSettings');
