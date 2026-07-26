/*
 * BouncEngine — SINGLE SOURCE OF TRUTH for the release version.
 *
 * This is the ONLY place a human edits the version number.
 *   - sw.js pulls it via importScripts() to build CACHE_NAME
 *   - the page fetches it over the network (cache-busted) to detect updates
 *
 * NOTE: index.html deliberately does NOT load this with a <script> tag. A CDN can
 * serve a cached copy to the tag while the update check reads a fresh one from the
 * origin; the two would disagree forever and the page would reload in a loop.
 *
 * Bump the string below to ship an update. Nothing else needs to change.
 */
self.APP_VERSION = 'v1.0.5';
