/**
 * Level Progress Encryption Module
 * 
 * Provides tamper-proof level unlock tracking using HMAC-SHA256.
 * Progress is bound to a per-device random key, making it impossible
 * to share unlock strings between players.
 * 
 * Usage:
 *   await LevelProgress.init();
 *   const unlocked = LevelProgress.isUnlocked(5);
 *   await LevelProgress.completeLevel(5);
 */

const LevelProgress = (function () {
    // Obfuscated storage keys
    const _PK = '_b' + String.fromCharCode(80, 114); // _bPr
    const _DK = '_b' + String.fromCharCode(68, 107); // _bDk
    const NOKIA_END = 11; // Nokia Originals: levels 1-11
    const PEPPER = '\x42\x30\x75\x4e\x63\x33\x5f\x50\x72\x30\x67\x72\x33\x73\x73'; // B0uNc3_Pr0gr3ss

    let _deviceKey = null;
    let _cryptoKey = null;
    let _progress = null; // Cached: { unlockedLevels: Set, nokiaComplete: bool }
    let _initialized = false;

    // ========== DEVICE KEY ==========
    // Generate or retrieve a random 256-bit device key.
    // This key is unique per browser/device and cannot be guessed.
    function _ensureDeviceKey() {
        if (_deviceKey) return _deviceKey;
        try {
            const stored = localStorage.getItem(_DK);
            if (stored && stored.length === 64) {
                _deviceKey = stored;
                return _deviceKey;
            }
        } catch (e) { }
        // Generate new random key
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        _deviceKey = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        try {
            localStorage.setItem(_DK, _deviceKey);
        } catch (e) { }
        return _deviceKey;
    }

    // ========== CRYPTO ==========
    // Derive CryptoKey from device key + pepper (stable across sessions)
    async function _deriveKey() {
        if (_cryptoKey) return _cryptoKey;
        const dk = _ensureDeviceKey();
        const fp = [PEPPER, dk].join('\x1F');
        const enc = new TextEncoder();
        const hash = await crypto.subtle.digest('SHA-256', enc.encode(fp));
        _cryptoKey = await crypto.subtle.importKey(
            'raw', hash, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        return _cryptoKey;
    }

    // Derive a legacy CryptoKey using old fingerprint values for migration
    async function _deriveLegacyKey(lang, colorDepth, tzOffset) {
        const dk = _ensureDeviceKey();
        const fp = [PEPPER, dk, lang, colorDepth, tzOffset].join('\x1F');
        const enc = new TextEncoder();
        const hash = await crypto.subtle.digest('SHA-256', enc.encode(fp));
        return crypto.subtle.importKey(
            'raw', hash, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
    }

    // Try to decode progress using legacy fingerprint-based keys
    async function _tryLegacyDecode(raw) {
        const lang = navigator.language || '';
        const colorDepth = (screen.colorDepth || 24).toString();
        const tzOffset = (new Date().getTimezoneOffset()).toString();
        // Generate candidate timezone offsets (current +/- 60 min for DST shifts)
        const currentTz = new Date().getTimezoneOffset();
        const tzCandidates = new Set([
            currentTz.toString(),
            (currentTz + 60).toString(),
            (currentTz - 60).toString()
        ]);
        try {
            const outer = JSON.parse(atob(raw));
            if (!outer.d || !outer.s) return null;
            const dataStr = atob(outer.d);
            const enc = new TextEncoder();
            // Try each timezone offset candidate
            for (const tz of tzCandidates) {
                const legacyKey = await _deriveLegacyKey(lang, colorDepth, tz);
                const sig = await crypto.subtle.sign('HMAC', legacyKey, enc.encode(dataStr));
                const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
                if (expected.length !== outer.s.length) continue;
                let diff = 0;
                for (let i = 0; i < expected.length; i++) {
                    diff |= expected.charCodeAt(i) ^ outer.s.charCodeAt(i);
                }
                if (diff === 0) {
                    const payload = JSON.parse(dataStr);
                    return {
                        unlockedLevels: new Set(Array.isArray(payload.u) ? payload.u.filter(n => typeof n === 'number' && n >= 1 && n <= 999) : [1]),
                        nokiaComplete: payload.n === 1
                    };
                }
            }
        } catch (e) { }
        return null;
    }

    // Sign data with HMAC-SHA256
    async function _sign(data) {
        const key = await _deriveKey();
        const enc = new TextEncoder();
        const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
        return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ========== ENCODING ==========
    // Encode progress to tamper-proof string
    async function _encode(levels, nokiaComplete) {
        const sorted = Array.from(levels).sort((a, b) => a - b);
        const payload = { u: sorted, n: nokiaComplete ? 1 : 0 };
        const dataStr = JSON.stringify(payload);
        const sig = await _sign(dataStr);
        // Double-encode: base64(JSON({ d: base64(payload), s: signature }))
        const inner = btoa(dataStr);
        const outer = JSON.stringify({ d: inner, s: sig });
        return btoa(outer);
    }

    // Decode and verify progress
    async function _decode(raw) {
        try {
            const outer = JSON.parse(atob(raw));
            if (!outer.d || !outer.s) return null;
            const dataStr = atob(outer.d);
            const expected = await _sign(dataStr);
            // Constant-time comparison
            if (expected.length !== outer.s.length) return null;
            let diff = 0;
            for (let i = 0; i < expected.length; i++) {
                diff |= expected.charCodeAt(i) ^ outer.s.charCodeAt(i);
            }
            if (diff !== 0) return null;
            const payload = JSON.parse(dataStr);
            return {
                unlockedLevels: new Set(Array.isArray(payload.u) ? payload.u.filter(n => typeof n === 'number' && n >= 1 && n <= 999) : [1]),
                nokiaComplete: payload.n === 1
            };
        } catch (e) {
            return null;
        }
    }

    // ========== PUBLIC API ==========

    /**
     * Initialize the progress system. Must be called before other methods.
     * Loads and verifies stored progress, resetting if tampered.
     * If already initialized, re-reads from storage to pick up changes.
     */
    async function init() {
        _ensureDeviceKey();
        try {
            const raw = localStorage.getItem(_PK);
            if (raw) {
                // Try new stable key first
                const decoded = await _decode(raw);
                if (decoded) {
                    decoded.unlockedLevels.add(1);
                    _progress = decoded;
                    _initialized = true;
                    return _progress;
                }
                // New key failed — try migrating from legacy fingerprint-based key
                const legacy = await _tryLegacyDecode(raw);
                if (legacy) {
                    legacy.unlockedLevels.add(1);
                    _progress = legacy;
                    _initialized = true;
                    // Re-sign with new stable key so future loads work
                    await _save();
                    return _progress;
                }
            }
        } catch (e) { }
        // Default: only level 1 unlocked
        _progress = { unlockedLevels: new Set([1]), nokiaComplete: false };
        await _save();
        _initialized = true;
        return _progress;
    }

    // Internal save
    async function _save() {
        const encoded = await _encode(_progress.unlockedLevels, _progress.nokiaComplete);
        try {
            localStorage.setItem(_PK, encoded);
        } catch (e) { }
    }

    /**
     * Check if a specific level number is unlocked.
     * @param {number} levelNum 
     * @returns {boolean}
     */
    function isUnlocked(levelNum) {
        if (!_initialized) return levelNum === 1;
        if (levelNum === 1) return true;
        if (_progress.nokiaComplete) return true;
        return _progress.unlockedLevels.has(levelNum);
    }

    /**
     * Mark a level as completed and unlock the next level.
     * If all Nokia levels (1-11) are completed, unlocks everything.
     * @param {number} levelNum - The level that was completed
     */
    async function completeLevel(levelNum) {
        if (!_initialized) await init();
        _progress.unlockedLevels.add(levelNum);
        // Unlock next level
        _progress.unlockedLevels.add(levelNum + 1);
        // Check Nokia completion
        let allNokia = true;
        for (let i = 1; i <= NOKIA_END; i++) {
            if (!_progress.unlockedLevels.has(i)) {
                allNokia = false;
                break;
            }
        }
        _progress.nokiaComplete = allNokia;
        await _save();
    }

    /**
     * Get all unlocked level numbers as an array.
     * @returns {number[]}
     */
    function getUnlockedLevels() {
        if (!_initialized) return [1];
        if (_progress.nokiaComplete) return null; // null = all unlocked
        return Array.from(_progress.unlockedLevels);
    }

    /**
     * Check if Nokia originals pack is complete.
     * @returns {boolean}
     */
    function isNokiaComplete() {
        if (!_initialized) return false;
        return _progress.nokiaComplete;
    }

    return {
        init,
        isUnlocked,
        completeLevel,
        getUnlockedLevels,
        isNokiaComplete
    };
})();
