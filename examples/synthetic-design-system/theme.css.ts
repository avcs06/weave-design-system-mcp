import { createGlobalTheme } from '@vanilla-extract/css';

/**
 * Synthetic color theme, resolved inline (unlike a real multi-theme system,
 * which usually splits shape (`createThemeContract`) from per-theme
 * resolution elsewhere) — kept simple here so this file alone has real
 * values to demonstrate `list_tokens` and `validate`'s suggestions with.
 */
export const vars = createGlobalTheme(':root', {
  color: {
    surface: '#FFFFFF',
    foreground: '#1A1A1A',
    accent: '#3B5BDB',
    accentHover: '#364FC7',
    danger: '#C92A2A',
  },
});
