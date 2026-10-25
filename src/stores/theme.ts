import { defineStore } from 'pinia';
import { readStorage, writeStorage } from '../utils/storage';

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
    },
  },
});
