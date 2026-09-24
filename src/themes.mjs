import { readFileSync } from "node:fs";

export const FONTS_DIR = new URL("./fonts/", import.meta.url);
export const FONTS = JSON.parse(readFileSync(new URL("fonts.json", FONTS_DIR), "utf8"));

// Theme presets: token overrides layered on top of base.css defaults.
// A site picks one with `theme.preset` and may override any token with
// `theme.tokens`. Presets mirror the existing Zagware customer designs.

export const PRESETS = {
  // Navy / green / amber outdoor-event look (car_website).
  classic: {
    tokens: {
      "--c-primary": "#003049",
      "--c-accent": "#e07a1c",
      "--c-surface": "#f4f1ec",
      "--c-surface-2": "#e9e4dc",
      "--c-dark": "#003049",
      "--c-dark-text": "#f6f4ef",
      "--c-dark-muted": "#a9c3d3",
      "--font-heading": '"Playfair Display", Georgia, serif',
      "--font-body": 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
    },
    fonts: ["playfair-display", "inter"],
  },
  // Forest / cream / brass rural brand look (ardleevan_website).
  heritage: {
    tokens: {
      "--c-bg": "#fffdf8",
      "--c-primary": "#1f3a2b",
      "--c-accent": "#b28437",
      "--c-surface": "#f6f1e6",
      "--c-surface-2": "#ece4d2",
      "--c-border": "#e3dac6",
      "--c-text": "#1d2320",
      "--c-muted": "#5b635d",
      "--c-dark": "#16291f",
      "--c-dark-text": "#f6f1e6",
      "--c-dark-muted": "#c9c2ad",
      "--font-heading": 'Bitter, Georgia, serif',
      "--font-body": '"Source Sans 3", system-ui, sans-serif',
      "--radius": "6px",
      "--radius-lg": "10px",
    },
    fonts: ["bitter", "source-sans-3"],
  },
  // Dark technical look (zagware.io).
  midnight: {
    tokens: {
      "--c-bg": "#0d1117",
      "--c-surface": "#131a24",
      "--c-surface-2": "#1c2533",
      "--c-text": "#e6edf3",
      "--c-muted": "#9aa7b4",
      "--c-border": "#263041",
      "--c-primary": "#4f9dff",
      "--c-primary-contrast": "#07111f",
      "--c-accent": "#3fd0a4",
      "--c-accent-contrast": "#04150f",
      "--c-dark": "#070b10",
      "--c-dark-text": "#e6edf3",
      "--c-dark-muted": "#8b98a5",
      "--font-heading": 'Inter, system-ui, sans-serif',
      "--font-body": 'Inter, system-ui, sans-serif',
      "--shadow": "0 10px 30px rgb(0 0 0 / 0.35)",
    },
    fonts: ["inter"],
  },
  // Neutral system-font preset with no external font requests.
  plain: { tokens: {}, fonts: [] },
};

export function resolveTheme(theme = {}) {
  const preset = PRESETS[theme.preset ?? "plain"];
  if (!preset) return { error: `theme.preset "${theme.preset}" is unknown (have: ${Object.keys(PRESETS).join(", ")})` };
  const tokens = { ...preset.tokens, ...(theme.tokens ?? {}) };
  // Fonts are self-hosted from src/fonts (no requests to Google): ids from fonts.json.
  const fonts = theme.fonts ?? preset.fonts;
  const unknown = fonts.filter((id) => !FONTS[id]);
  if (unknown.length) return { error: `theme.fonts: unknown font id(s) ${unknown.join(", ")} (have: ${Object.keys(FONTS).join(", ")})` };
  return { tokens, fonts };
}

export function themeCss(tokens) {
  const body = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return body ? `:root {\n${body}\n}\n` : "";
}
