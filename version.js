/*
 * BouncEngine — SINGLE SOURCE OF TRUTH for the release version.
 *
 * This is the ONLY place a human edits the version number.
 *   - index.html loads this as a <script> (sets window.APP_VERSION)
 *   - sw.js pulls it via importScripts() to build CACHE_NAME
 *   - the client update check fetches this file and compares
 *
 * Bump the string below to ship an update. Nothing else needs to change.
 */
self.APP_VERSION = 'v0.9.9997';
