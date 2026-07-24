/**
 * IndexedDB Storage Module for Bounce
 * 
 * Provides a simple async API for storing large data (levels) in IndexedDB
 * while keeping small settings in localStorage.
 * 
 * Usage:
 *   await BounceStorage.init();
 *   await BounceStorage.saveLevels(levelsArray);
 *   const levels = await BounceStorage.getLevels();
 *   await BounceStorage.saveAutosave(levelData);
 *   const autosave = await BounceStorage.getAutosave();
 */

const BounceStorage = (function() {
    const DB_NAME = 'BounceGameDB';
    const DB_VERSION = 1;
    const STORE_LEVELS = 'levels';
    const STORE_AUTOSAVE = 'autosave';
    
    let db = null;
    let initPromise = null;
    
    /**
     * Initialize the IndexedDB database
     * @returns {Promise<IDBDatabase>}
     */
    function init() {
        if (db) return Promise.resolve(db);
        if (initPromise) return initPromise;
        
        initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = (event) => {
                console.error('[BounceStorage] Failed to open IndexedDB:', event.target.error);
                reject(event.target.error);
            };
            
            request.onsuccess = (event) => {
                db = event.target.result;
                console.log('[BounceStorage] IndexedDB initialized');
                resolve(db);
            };
            
            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                
                // Create object store for local levels
                // Each level is stored individually with its name as key
                if (!database.objectStoreNames.contains(STORE_LEVELS)) {
                    const levelStore = database.createObjectStore(STORE_LEVELS, { keyPath: 'name' });
                    levelStore.createIndex('savedAt', 'savedAt', { unique: false });
                    console.log('[BounceStorage] Created levels store');
                }
                
                // Create object store for autosave (single entry)
                if (!database.objectStoreNames.contains(STORE_AUTOSAVE)) {
                    database.createObjectStore(STORE_AUTOSAVE, { keyPath: 'id' });
                    console.log('[BounceStorage] Created autosave store');
                }
            };
        });
        
        return initPromise;
    }
    
    /**
     * Get all saved levels
     * @returns {Promise<Array>} Array of level objects
     */
    async function getLevels() {
        await init();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_LEVELS], 'readonly');
            const store = transaction.objectStore(STORE_LEVELS);
            const request = store.getAll();
            
            request.onsuccess = () => {
                resolve(request.result || []);
            };
            
            request.onerror = (event) => {
                console.error('[BounceStorage] Failed to get levels:', event.target.error);
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get a single level by name
     * @param {string} name - Level name
     * @returns {Promise<Object|null>} Level object or null if not found
     */
    async function getLevel(name) {
        await init();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_LEVELS], 'readonly');
            const store = transaction.objectStore(STORE_LEVELS);
            const request = store.get(name);
            
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            
            request.onerror = (event) => {
                console.error('[BounceStorage] Failed to get level:', event.target.error);
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Save a single level (add or update)
     * @param {Object} level - Level object (must have 'name' property)
     * @returns {Promise<void>}
     */
    async function saveLevel(level) {
        await init();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_LEVELS], 'readwrite');
            const store = transaction.objectStore(STORE_LEVELS);
            const request = store.put(level);
            
            request.onsuccess = () => {
                resolve();
            };
            
            request.onerror = (event) => {
                console.error('[BounceStorage] Failed to save level:', event.target.error);
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Save multiple levels (replaces all existing levels)
     * @param {Array} levels - Array of level objects
     * @returns {Promise<void>}
     */
    async function saveLevels(levels) {
        await init();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_LEVELS], 'readwrite');
            const store = transaction.objectStore(STORE_LEVELS);
            
            // Clear existing and add all new levels
            const clearRequest = store.clear();
            
            clearRequest.onsuccess = () => {
                let completed = 0;
                if (levels.length === 0) {
                    resolve();
                    return;
                }
                
                for (const level of levels) {
                    const addRequest = store.put(level);
                    addRequest.onsuccess = () => {
                        completed++;
                        if (completed === levels.length) {
                            resolve();
                        }
                    };
                    addRequest.onerror = (event) => {
                        console.error('[BounceStorage] Failed to add level:', event.target.error);
                    };
                }
            };
            
            clearRequest.onerror = (event) => {
                console.error('[BounceStorage] Failed to clear levels:', event.target.error);
                reject(event.target.error);
            };
            
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Delete a level by name
     * @param {string} name - Level name
     * @returns {Promise<void>}
     */
    async function deleteLevel(name) {
        await init();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_LEVELS], 'readwrite');
            const store = transaction.objectStore(STORE_LEVELS);
            const request = store.delete(name);
            
            request.onsuccess = () => {
                resolve();
            };
            
            request.onerror = (event) => {
                console.error('[BounceStorage] Failed to delete level:', event.target.error);
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get autosave data
     * @returns {Promise<Object|null>} Autosave data or null if none exists
     */
    async function getAutosave() {
        await init();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_AUTOSAVE], 'readonly');
            const store = transaction.objectStore(STORE_AUTOSAVE);
            const request = store.get('current');
            
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    // Remove the internal 'id' key before returning
                    delete result.id;
                    resolve(result);
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = (event) => {
                console.error('[BounceStorage] Failed to get autosave:', event.target.error);
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Save autosave data
     * @param {Object} data - Level data to autosave
     * @returns {Promise<void>}
     */
    async function saveAutosave(data) {
        await init();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_AUTOSAVE], 'readwrite');
            const store = transaction.objectStore(STORE_AUTOSAVE);
            
            // Add internal id for keyPath
            const saveData = { ...data, id: 'current' };
            const request = store.put(saveData);
            
            request.onsuccess = () => {
                resolve();
            };
            
            request.onerror = (event) => {
                console.error('[BounceStorage] Failed to save autosave:', event.target.error);
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Clear autosave data
     * @returns {Promise<void>}
     */
    async function clearAutosave() {
        await init();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_AUTOSAVE], 'readwrite');
            const store = transaction.objectStore(STORE_AUTOSAVE);
            const request = store.delete('current');
            
            request.onsuccess = () => {
                resolve();
            };
            
            request.onerror = (event) => {
                console.error('[BounceStorage] Failed to clear autosave:', event.target.error);
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Migrate data from localStorage to IndexedDB (one-time migration)
     * Call this on first load to move existing data
     * @returns {Promise<{levels: number, autosave: boolean}>} Migration stats
     */
    async function migrateFromLocalStorage() {
        await init();
        
        const stats = { levels: 0, autosave: false };
        
        // Migrate local levels
        const localLevelsKey = 'bounceEditor_localLevels';
        const localLevelsData = localStorage.getItem(localLevelsKey);
        
        if (localLevelsData) {
            try {
                const levels = JSON.parse(localLevelsData);
                if (Array.isArray(levels) && levels.length > 0) {
                    // Check if IndexedDB already has levels (don't overwrite)
                    const existingLevels = await getLevels();
                    if (existingLevels.length === 0) {
                        await saveLevels(levels);
                        stats.levels = levels.length;
                        console.log(`[BounceStorage] Migrated ${levels.length} levels from localStorage`);
                    }
                    // Remove from localStorage after successful migration
                    localStorage.removeItem(localLevelsKey);
                }
            } catch (e) {
                console.warn('[BounceStorage] Failed to migrate levels:', e);
            }
        }
        
        // Migrate autosave
        const autosaveKey = 'bounceEditor_autosave';
        const autosaveData = localStorage.getItem(autosaveKey);
        
        if (autosaveData) {
            try {
                const data = JSON.parse(autosaveData);
                if (data && typeof data === 'object') {
                    // Check if IndexedDB already has autosave
                    const existingAutosave = await getAutosave();
                    if (!existingAutosave) {
                        await saveAutosave(data);
                        stats.autosave = true;
                        console.log('[BounceStorage] Migrated autosave from localStorage');
                    }
                    // Remove from localStorage after successful migration
                    localStorage.removeItem(autosaveKey);
                }
            } catch (e) {
                console.warn('[BounceStorage] Failed to migrate autosave:', e);
            }
        }
        
        return stats;
    }
    
    /**
     * Check if IndexedDB is available
     * @returns {boolean}
     */
    function isAvailable() {
        return typeof indexedDB !== 'undefined';
    }
    
    // Public API
    return {
        init,
        isAvailable,
        getLevels,
        getLevel,
        saveLevel,
        saveLevels,
        deleteLevel,
        getAutosave,
        saveAutosave,
        clearAutosave,
        migrateFromLocalStorage
    };
})();

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
    BounceStorage.init().catch(e => {
        console.error('[BounceStorage] Auto-init failed:', e);
    });
}
