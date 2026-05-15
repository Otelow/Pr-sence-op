// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
// MODIFIÉ CHANTIER 7 — 14/05/2026 — persistance SQLite des états bot

const { createConnection } = require('../../shared/database');

let db = null;

function getDb() {
    if (db) return db;
    db = createConnection();
    db.exec(`
        CREATE TABLE IF NOT EXISTS bot_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    return db;
}

function loadState(key, fallback = null) {
    try {
        const row = getDb().prepare('SELECT value FROM bot_state WHERE key = ?').get(key);
        if (!row?.value) return fallback;
        return JSON.parse(row.value);
    } catch (e) {
        log.error(`[bot_state] load ${key}:`, e.message);
        return fallback;
    }
}

function saveState(key, value) {
    try {
        getDb().prepare(`
            INSERT INTO bot_state (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(key, JSON.stringify(value), Math.floor(Date.now() / 1000));
    } catch (e) {
        log.error(`[bot_state] save ${key}:`, e.message);
    }
}

function deleteState(key) {
    try {
        getDb().prepare('DELETE FROM bot_state WHERE key = ?').run(key);
    } catch (e) {
        log.error(`[bot_state] delete ${key}:`, e.message);
    }
}

module.exports = {
    loadState,
    saveState,
    deleteState,
};
