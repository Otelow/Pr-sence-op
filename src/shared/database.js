// FINAL POST-STAB A 17/05/2026 ? pino backend
const log = require('./logger');
// STABILISATION 15/05/2026 — corrections sécurité et persistance
const fs = require('fs');
const path = require('path');
const config = require('./config');

let sqliteModule = null;

function ensureDataDirs() {
    for (const dir of [config.paths.data, config.paths.backups, config.paths.uploads, config.paths.craftsUploads]) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadSQLite() {
    if (sqliteModule) return sqliteModule;
    try {
        sqliteModule = require('better-sqlite3');
        return sqliteModule;
    } catch (error) {
        error.message = `SQLite module unavailable: ${error.message}`;
        throw error;
    }
}

function createConnection(databasePath = config.paths.database) {
    ensureDataDirs();
    const SQLite = loadSQLite();
    const resolvedPath = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    const db = new SQLite(resolvedPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
}

function runMigration(db, name, migrate) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const exists = db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(name);
    if (exists) return false;

    const transaction = db.transaction(() => {
        migrate(db);
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    });
    transaction();
    return true;
}

function safeGet(db, sql, params = []) {
    try {
        return db.prepare(sql).get(...params);
    } catch (error) {
        log.error('[database] safeGet failed:', error.message);
        return null;
    }
}

function safeAll(db, sql, params = []) {
    try {
        return db.prepare(sql).all(...params);
    } catch (error) {
        log.error('[database] safeAll failed:', error.message);
        return [];
    }
}

module.exports = {
    ensureDataDirs,
    createConnection,
    runMigration,
    safeGet,
    safeAll
};
