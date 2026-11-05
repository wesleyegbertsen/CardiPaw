import { registerPlugin } from '@capacitor/core';

interface ImmersiveModePlugin {
  /** Hides the status and navigation bars; a swipe from the edge shows them for a moment. */
  enter(): Promise<void>;
  /** Shows the system bars again. */
  exit(): Promise<void>;
}

/**
 * App only (android/app/.../ImmersiveModePlugin.java): no web implementation. Not
 * Capacitor's SystemBars.hide(): that keeps the default bar behaviour, where a touch (before
 * Android 12) or a swipe brings the bars back for good and can resize the page mid-count.
 */
export const ImmersiveMode = registerPlugin<ImmersiveModePlugin>('ImmersiveMode');
