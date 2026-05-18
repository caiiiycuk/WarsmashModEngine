/**
 * Build / version constants. BUILD_ID is the build's wall-clock so we
 * can cache-bust references to engine-worker-boot.js, scripts, etc.
 * across a refresh; VERSION is the user-visible release number that
 * shows up in the bottom-right corner and pairs with html/CHANGELOG.md.
 */

// Bump on user-visible releases. Mirror the entry in html/CHANGELOG.md.
export const VERSION = '0.2.0';

// Wall-clock at module evaluation. Stable for the lifetime of the page,
// changes per refresh — exactly what we want for a cache-buster.
export const BUILD_ID = String(Date.now());

/** Append `?v=<BUILD_ID>` to a path — used for any asset whose URL
 *  needs to invalidate when a new build is deployed.
 *
 *  Uses a relative URL because the app now has one HTML entrypoint and
 *  Vite output is intentionally deployable below an arbitrary base path. */
export function versionedAsset(path: string): string {
  const cleaned = path.replace(/^\/+/, '');
  return `./${cleaned}?v=${encodeURIComponent(BUILD_ID)}`;
}
