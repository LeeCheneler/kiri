/**
 * SPA bytes baked into the compiled binary, keyed by the absolute URL
 * path a browser would request (e.g. `/index.html`, `/app.js`,
 * `/assets/icon-abc.png`).
 *
 * This file is the empty stub on the main branch — the map starts
 * empty. The release pipeline overwrites it in place before
 * `bun build --compile` so the resulting binary carries the SPA inside
 * itself and can serve it from any cwd. Locally, `bun run build:embed`
 * reproduces the overwrite for manual verification.
 *
 * `createApp` mounts the embedded SPA handler when `staticRoot` is
 * `undefined` and the map is non-empty; otherwise it falls back to
 * serving `staticRoot` from disk (dev, tests, and `bun start` from
 * this repo all use the disk path).
 *
 * Keep this file's export shape stable. The generator overwrites the
 * whole module — don't add logic here.
 */

export const EMBEDDED_FILES: Map<string, Uint8Array> = new Map();
