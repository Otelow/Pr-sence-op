// AUDIT HARDENING 21/05/2026 - store de session SQLite sans sqlite3 natif
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const Database = require('better-sqlite3');

function assertSafeTableName(table) {
    if (!/^[A-Za-z0-9_]+$/.test(table)) {
        throw new Error('Nom de table session invalide');
    }
    return table;
}

function expirationFromSession(sess, ttlMs) {
    const cookieExpires = sess?.cookie?.expires;
    if (cookieExpires) {
        const expiresAt = new Date(cookieExpires).getTime();
        if (Number.isFinite(expiresAt)) return expiresAt;
    }
    return Date.now() + ttlMs;
}

function normalizeStoredExpiration(expired) {
    const value = Number(expired);
    if (!Number.isFinite(value)) return 0;
    return value < 100000000000 ? value * 1000 : value;
}

function createBetterSqliteSessionStore(options = {}) {
    const dir = options.dir || process.cwd();
    const dbName = options.db || 'sessions.db';
    const table = assertSafeTableName(options.table || 'sessions');
    const ttlMs = Number(options.ttlMs || options.ttlSeconds * 1000 || 7 * 24 * 60 * 60 * 1000);

    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, dbName);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
            sid TEXT PRIMARY KEY,
            expired INTEGER NOT NULL,
            sess TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${table}_expired ON ${table}(expired);
    `);

    const getStmt = db.prepare(`SELECT sess, expired FROM ${table} WHERE sid = ?`);
    const setStmt = db.prepare(`
        INSERT INTO ${table} (sid, expired, sess)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET expired = excluded.expired, sess = excluded.sess
    `);
    const touchStmt = db.prepare(`UPDATE ${table} SET expired = ? WHERE sid = ?`);
    const destroyStmt = db.prepare(`DELETE FROM ${table} WHERE sid = ?`);
    const clearStmt = db.prepare(`DELETE FROM ${table}`);
    const pruneStmt = db.prepare(`
        DELETE FROM ${table}
        WHERE (expired >= 100000000000 AND expired <= ?)
           OR (expired < 100000000000 AND expired <= ?)
    `);
    const countStmt = db.prepare(`
        SELECT COUNT(*) AS count FROM ${table}
        WHERE (expired >= 100000000000 AND expired > ?)
           OR (expired < 100000000000 AND expired > ?)
    `);

    class BetterSqliteSessionStore extends session.Store {
        get(sid, callback) {
            try {
                const row = getStmt.get(sid);
                if (!row) return callback(null, null);
                if (normalizeStoredExpiration(row.expired) <= Date.now()) {
                    destroyStmt.run(sid);
                    return callback(null, null);
                }
                return callback(null, JSON.parse(row.sess));
            } catch (error) {
                return callback(error);
            }
        }

        set(sid, sess, callback = () => {}) {
            try {
                setStmt.run(sid, expirationFromSession(sess, ttlMs), JSON.stringify(sess));
                callback(null);
            } catch (error) {
                callback(error);
            }
        }

        destroy(sid, callback = () => {}) {
            try {
                destroyStmt.run(sid);
                callback(null);
            } catch (error) {
                callback(error);
            }
        }

        touch(sid, sess, callback = () => {}) {
            try {
                const expiresAt = expirationFromSession(sess, ttlMs);
                const result = touchStmt.run(expiresAt, sid);
                if (!result.changes) setStmt.run(sid, expiresAt, JSON.stringify(sess));
                callback(null);
            } catch (error) {
                callback(error);
            }
        }

        clear(callback = () => {}) {
            try {
                clearStmt.run();
                callback(null);
            } catch (error) {
                callback(error);
            }
        }

        length(callback) {
            try {
                this.pruneExpired();
                const nowMs = Date.now();
                const nowSeconds = Math.floor(nowMs / 1000);
                callback(null, countStmt.get(nowMs, nowSeconds).count);
            } catch (error) {
                callback(error);
            }
        }

        pruneExpired() {
            const nowMs = Date.now();
            const nowSeconds = Math.floor(nowMs / 1000);
            pruneStmt.run(nowMs, nowSeconds);
        }

        close() {
            db.close();
        }
    }

    return new BetterSqliteSessionStore();
}

module.exports = {
    createBetterSqliteSessionStore,
};
