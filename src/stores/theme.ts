import { defineStore } from 'pinia';

export const useThemeStore = defineStore('theme', {
  state: () => ({ isDark: false }),
  actions: {
    init() {
      const saved = localStorage.getItem('cardipaw-theme');
      this.isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      this._apply();
    },
    toggle() {
      this.isDark = !this.isDark;
      localStorage.setItem('cardipaw-theme', this.isDark ? 'dark' : 'light');
      this._apply();
    },
    _apply() {
      document.documentElement.setAttribute('data-theme', this.isDark ? 'dark' : 'light');
    },
  },
});
