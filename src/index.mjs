// Public API for programmatic use (the `zsite` CLI wraps these).
export { build, BuildError, checkLinks, createContext } from "./build.mjs";
export { loadComponents } from "./components.mjs";
export { normalizeSite, loadSiteConfig } from "./config.mjs";
export { dev, serveStatic } from "./dev-server.mjs";
export { scaffold } from "./scaffold.mjs";
export { PRESETS } from "./themes.mjs";
export { TARGETS } from "./targets.mjs";
export * as html from "./html.mjs";

/** Identity helper so site configs can `export default defineSite({...})`. */
export const defineSite = (config) => config;
