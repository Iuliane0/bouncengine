// ChunkManager - Dynamic tile loading for massive levels
// Supports levels up to 65,535 x 65,535 tiles

const ChunkManager = (function () {
    const CHUNK_SIZE = 64; // 64x64 tiles per chunk
    const CHUNK_SHIFT = 6; // log2(64) — for bitwise division
    const CHUNK_MASK = 63; // 64 - 1 — for bitwise modulo
    const ACTIVE_RADIUS = 1; // Load chunks within 1 chunk of player (3x3 grid)

    // Level dimensions (can be set dynamically)
    let levelCols = 0;
    let levelRows = 0;

    // Chunk storage: Map<numericKey, Uint8Array>
    // Key = chunkX << 16 | chunkY — no string allocation
    const chunks = new Map();

    // 4-slot direct-mapped cache for hot-path getTile/setTile.
    // Render loops scan left-to-right across rows that may straddle 2 horizontal
    // chunks × 1-2 vertical chunks. A single-entry cache thrashes on every tile
    // when the camera straddles a chunk boundary (col 64, 128, 192, …), causing
    // hundreds of Map.get() lookups per frame. 4 slots cover the typical 2×2
    // chunk working set and eliminate ~99% of Map lookups.
    const _cacheKeys = [-1, -1, -1, -1];
    const _cacheChunks = [null, null, null, null];
    let _cacheNext = 0; // Round-robin eviction pointer

    // Current player chunk position
    let playerChunkX = 0;
    let playerChunkY = 0;

    // Chunk generator function (can be overridden for procedural levels)
    let chunkGenerator = null;

    // Initialize with level dimensions
    function init(cols, rows, generator = null) {
        levelCols = cols;
        levelRows = rows;
        chunkGenerator = generator;
        chunks.clear();
        _cacheKeys[0] = _cacheKeys[1] = _cacheKeys[2] = _cacheKeys[3] = -1;
        _cacheChunks[0] = _cacheChunks[1] = _cacheChunks[2] = _cacheChunks[3] = null;
        _cacheNext = 0;
    }

    // Load or generate a chunk
    function loadChunk(chunkX, chunkY) {
        const key = chunkX << 16 | chunkY;
        const existing = chunks.get(key);
        if (existing !== undefined) return existing;

        // Create new chunk (CHUNK_SIZE x CHUNK_SIZE)
        const chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

        if (chunkGenerator) {
            // Use custom generator
            chunkGenerator(chunk, chunkX, chunkY, CHUNK_SIZE);
        } else {
            // Default: empty (0 = air)
            chunk.fill(0);
        }

        chunks.set(key, chunk);
        return chunk;
    }

    // Unload chunks far from player
    function unloadDistantChunks() {
        for (const [key, _] of chunks) {
            const cx = key >> 16;
            const cy = key & 0xFFFF;
            const dx = Math.abs(cx - playerChunkX);
            const dy = Math.abs(cy - playerChunkY);

            // Keep chunks within 2x radius for buffer
            if (dx > ACTIVE_RADIUS + 1 || dy > ACTIVE_RADIUS + 1) {
                chunks.delete(key);
                // Invalidate cache entries pointing to this chunk
                for (let i = 0; i < 4; i++) {
                    if (_cacheKeys[i] === key) {
                        _cacheKeys[i] = -1;
                        _cacheChunks[i] = null;
                    }
                }
            }
        }
    }

    // Update active chunks based on player position (in tile coordinates)
    function updateActiveChunks(playerCol, playerRow) {
        playerChunkX = playerCol >> CHUNK_SHIFT;
        playerChunkY = playerRow >> CHUNK_SHIFT;

        // Precompute bounds once (not inside the loop)
        const maxChunkX = Math.ceil(levelCols / CHUNK_SIZE);
        const maxChunkY = Math.ceil(levelRows / CHUNK_SIZE);

        // Preload chunks around player
        for (let dy = -ACTIVE_RADIUS; dy <= ACTIVE_RADIUS; dy++) {
            for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) {
                const cx = playerChunkX + dx;
                const cy = playerChunkY + dy;

                if (cx >= 0 && cx < maxChunkX && cy >= 0 && cy < maxChunkY) {
                    loadChunk(cx, cy);
                }
            }
        }

        // Cleanup distant chunks
        unloadDistantChunks();
    }

    // Inline chunk lookup with 4-slot cache — hot path, called 500+ times per frame
    function getTile(col, row) {
        if (col < 0 || col >= levelCols || row < 0 || row >= levelRows) {
            return 1; // Out of bounds = solid wall
        }

        const key = (col >> CHUNK_SHIFT) << 16 | (row >> CHUNK_SHIFT);

        // Check all 4 cache slots (unrolled for speed)
        if (_cacheKeys[0] === key) return _cacheChunks[0][(row & CHUNK_MASK) * CHUNK_SIZE + (col & CHUNK_MASK)];
        if (_cacheKeys[1] === key) return _cacheChunks[1][(row & CHUNK_MASK) * CHUNK_SIZE + (col & CHUNK_MASK)];
        if (_cacheKeys[2] === key) return _cacheChunks[2][(row & CHUNK_MASK) * CHUNK_SIZE + (col & CHUNK_MASK)];
        if (_cacheKeys[3] === key) return _cacheChunks[3][(row & CHUNK_MASK) * CHUNK_SIZE + (col & CHUNK_MASK)];

        // Cache miss — load chunk and evict oldest slot (round-robin)
        const chunk = loadChunk(col >> CHUNK_SHIFT, row >> CHUNK_SHIFT);
        const slot = _cacheNext;
        _cacheKeys[slot] = key;
        _cacheChunks[slot] = chunk;
        _cacheNext = (slot + 1) & 3;
        return chunk[(row & CHUNK_MASK) * CHUNK_SIZE + (col & CHUNK_MASK)];
    }

    // Set tile value at (col, row)
    function setTile(col, row, value) {
        if (col < 0 || col >= levelCols || row < 0 || row >= levelRows) {
            return;
        }

        const key = (col >> CHUNK_SHIFT) << 16 | (row >> CHUNK_SHIFT);

        // Check cache first
        let chunk = null;
        if (_cacheKeys[0] === key) chunk = _cacheChunks[0];
        else if (_cacheKeys[1] === key) chunk = _cacheChunks[1];
        else if (_cacheKeys[2] === key) chunk = _cacheChunks[2];
        else if (_cacheKeys[3] === key) chunk = _cacheChunks[3];

        if (!chunk) {
            chunk = loadChunk(col >> CHUNK_SHIFT, row >> CHUNK_SHIFT);
            const slot = _cacheNext;
            _cacheKeys[slot] = key;
            _cacheChunks[slot] = chunk;
            _cacheNext = (slot + 1) & 3;
        }

        chunk[(row & CHUNK_MASK) * CHUNK_SIZE + (col & CHUNK_MASK)] = value;
    }

    // Get current memory usage (approximate)
    function getMemoryUsage() {
        return chunks.size * CHUNK_SIZE * CHUNK_SIZE; // bytes
    }

    // Get level dimensions
    function getCols() { return levelCols; }
    function getRows() { return levelRows; }
    function getChunkSize() { return CHUNK_SIZE; }

    return {
        init,
        getTile,
        setTile,
        updateActiveChunks,
        getMemoryUsage,
        getCols,
        getRows,
        getChunkSize,
        CHUNK_SIZE
    };
})();
