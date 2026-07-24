/**
 * Console Script: Import Classic Levels to IndexedDB
 * 
 * USAGE:
 * 1. Open the editor in your browser (editor/index.html)
 * 2. Open browser console (F12)
 * 3. Set LEVELS_TO_IMPORT below (examples: [1], [1,2,3], or 'all')
 * 4. Copy and paste this entire script
 * 5. Press Enter to execute
 * 
 * This will import specified levels from levels.js into your editor's IndexedDB storage
 */

(async function importClassicLevels() {
    // ========== CONFIGURATION ==========
    // Set which levels to import:
    // - 'all' = import all levels
    // - [1] = import only level 1
    // - [1,2,3] = import levels 1, 2, and 3
    // - [5,10,15] = import levels 5, 10, and 15
    const LEVELS_TO_IMPORT = 'all'; // <-- CHANGE THIS
    // ===================================
    
    console.log('🎮 Starting Classic Levels Import (IndexedDB)...');
    
    // Check if BounceStorage is available
    if (typeof BounceStorage === 'undefined') {
        console.error('❌ BounceStorage not found. Make sure you are running this from the editor page.');
        return;
    }
    
    try {
        // Initialize storage
        await BounceStorage.init();
        
        // Load the levels.js file
        const response = await fetch('../engine/levels.js');
        const scriptText = await response.text();
        
        // Execute the script to get CLASSIC_LEVELS
        const scriptFunc = new Function(scriptText + '; return CLASSIC_LEVELS;');
        const CLASSIC_LEVELS = scriptFunc();
        
        if (!CLASSIC_LEVELS || !Array.isArray(CLASSIC_LEVELS)) {
            console.error('❌ Failed to load CLASSIC_LEVELS from levels.js');
            return;
        }
        
        // Determine which levels to import
        let levelsToImport;
        if (LEVELS_TO_IMPORT === 'all') {
            levelsToImport = CLASSIC_LEVELS.map((_, idx) => idx);
            console.log(`📦 Importing ALL ${CLASSIC_LEVELS.length} levels`);
        } else if (Array.isArray(LEVELS_TO_IMPORT)) {
            // Convert 1-based indices to 0-based
            levelsToImport = LEVELS_TO_IMPORT.map(num => num - 1);
            
            // Validate indices
            const invalid = levelsToImport.filter(idx => idx < 0 || idx >= CLASSIC_LEVELS.length);
            if (invalid.length > 0) {
                const invalidDisplay = invalid.map(idx => idx + 1).join(', ');
                console.error(`❌ Invalid level numbers: ${invalidDisplay} (valid range: 1-${CLASSIC_LEVELS.length})`);
                return;
            }
            
            console.log(`📦 Importing ${levelsToImport.length} level(s): ${LEVELS_TO_IMPORT.join(', ')}`);
        } else {
            console.error('❌ LEVELS_TO_IMPORT must be "all" or an array like [1,2,3]');
            return;
        }
        
        console.log(`📦 Found ${levelsToImport.length} levels to import`);
        
        // Get existing local levels from IndexedDB
        let existingLevels = await BounceStorage.getLevels();
        const existingNames = new Set(existingLevels.map(l => l.name));
        
        if (existingLevels.length > 0) {
            const proceed = confirm(
                `⚠️ You already have ${existingLevels.length} level(s) in IndexedDB.\n\n` +
                `Do you want to:\n` +
                `• OK = APPEND ${levelsToImport.length} level(s) (keep existing)\n` +
                `• Cancel = REPLACE all with ${levelsToImport.length} level(s)`
            );
            
            if (!proceed) {
                // Will save all new levels (clearing happens via saveLevels)
                console.log('🗑️ Will replace existing levels...');
                existingLevels = [];
                existingNames.clear();
            }
        }
        
        // Import each level
        let imported = 0;
        let skipped = 0;
        const newLevels = [...existingLevels];
        
        for (let i = 0; i < levelsToImport.length; i++) {
            const levelIdx = levelsToImport[i];
            const level = CLASSIC_LEVELS[levelIdx];
            
            // Skip undefined or invalid levels
            if (!level || typeof level !== 'object') {
                console.warn(`⚠️ Skipping invalid level at index ${levelIdx}`);
                skipped++;
                continue;
            }
            
            // Convert level data to editor format
            const editorLevel = {
                name: level.name || `Level ${levelIdx + 1}`,
                width: level.width || 11,
                height: level.height || 8,
                spawnX: level.spawnX ?? 30,
                spawnY: level.spawnY ?? 30,
                spawnSize: level.spawnSize ?? 12,
                doorCol: level.doorCol ?? 8,
                doorRow: level.doorRow ?? 5,
                tiles: level.tiles,
                spiders: level.spiders || [],
                savedAt: new Date().toISOString()
            };
            
            // Check for duplicate names and rename if needed
            const baseName = editorLevel.name;
            let nameCounter = 1;
            while (existingNames.has(editorLevel.name)) {
                editorLevel.name = `${baseName} (${nameCounter++})`;
            }
            
            existingNames.add(editorLevel.name);
            newLevels.push(editorLevel);
            imported++;
            
            // Log progress every 10 levels
            if ((i + 1) % 10 === 0 || levelsToImport.length <= 10) {
                console.log(`📝 Imported ${i + 1}/${levelsToImport.length} levels...`);
            }
        }
        
        // Save all levels to IndexedDB
        await BounceStorage.saveLevels(newLevels);
        
        console.log(`✅ Successfully imported ${imported} level(s)!`);
        if (skipped > 0) {
            console.log(`⚠️ Skipped ${skipped} invalid level(s)`);
        }
        console.log(`📍 Total levels in IndexedDB: ${newLevels.length}`);
        console.log(`💡 Click "Load" button and switch to "Local" tab to access them`);
        
        // Show success message
        alert(
            `✅ Import Complete!\n\n` +
            `Imported: ${imported} levels\n` +
            (skipped > 0 ? `Skipped: ${skipped} invalid levels\n` : '') +
            `Total in storage: ${newLevels.length}\n\n` +
            `Click "Load" → "Local" tab to access them.`
        );
        
    } catch (error) {
        console.error('❌ Import failed:', error);
        alert(`Import failed: ${error.message}`);
    }
})();
