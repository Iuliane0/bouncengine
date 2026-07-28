/*
 * BouncEngine — SINGLE SOURCE OF TRUTH for the release version.
 *
 * This is the ONLY place a human edits the version number.
 *   - the page fetches it over the network (cache-busted) to detect updates
 *   - the page then registers the worker as /sw.js?v=<this>, which is where sw.js
 *     reads it from. sw.js must NOT importScripts() this file: Cloudflare edge-
 *     caches .js on this origin and importScripts cannot bust that, which pinned
 *     the worker's cache name to an old release and froze the engine.
 *
 * NOTE: index.html deliberately does NOT load this with a <script> tag. A CDN can
 * serve a cached copy to the tag while the update check reads a fresh one from the
 * origin; the two would disagree forever and the page would reload in a loop.
 *
 * Bump the string below to ship an update. Nothing else needs to change.
 */
self.APP_VERSION = 'v1.3.0';
