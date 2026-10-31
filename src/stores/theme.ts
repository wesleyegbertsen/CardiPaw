import { defineStore } from 'pinia';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { readStorage, writeStorage } from '../utils/storage';
import { isNative } from '../utils/platform';

export const useThemeStore = defineStore('theme', {
  state: () => ({ isDark: false }),
  actions: {
    init() {
      const saved = readStorage('cardipaw-theme');
      this.isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      this._apply();
    },
    toggle() {
      this.isDark = !this.isDark;
      writeStorage('cardipaw-theme', this.isDark ? 'dark' : 'light');
      this._apply();
    },
    _apply() {
      document.documentElement.setAttribute('data-theme', this.isDark ? 'dark' : 'light');
      // App: the status and navigation bar icons follow the app's theme, not the phone's
      // (Dark = light icons for a dark page).
      if (isNative()) {
        SystemBars.setStyle({
          style: this.isDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
        }).catch((e) => console.error('Setting the system bar style failed', e));
      }
    },
  },
});
