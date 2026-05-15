// STABILISATION FINALE v2 16/05/2026 — utilitaire audit log admin SQLite
const { createConnection } = require('./database');
const config = require('./config');
const log = require('./logger');

let db;

function getDb() {
    if (!db) db = createConnection(config.paths.database);
    return db;
}

function audit(user, action, opts = {}) {
    const { target_type, target_id, details } = opts;
    try {
        getDb().prepare(`
            INSERT INTO audit_log
                (created_at, user_id, user_name, action, target_type, target_id, details)
            VALUES (strftime('%s','now'), ?, ?, ?, ?, ?, ?)
        `).run(
            user?.id || null,
            user?.username || user?.name || null,
            action,
            target_type || null,
            target_id !== undefined && target_id !== null ? String(target_id) : null,
            details ? JSON.stringify(details) : null
        );
    } catch (e) {
        log.warn({ err: e.message, action }, 'audit log écriture échouée');
    }
}

function listAuditLogs({ limit = 100, offset = 0, action, user_id, since } = {}) {
    const clauses = [];
    const params = [];

    if (action) {
        clauses.push('action = ?');
        params.push(String(action));
    }
    if (user_id) {
        clauses.push('user_id = ?');
        params.push(String(user_id));
    }
    if (since) {
        clauses.push('created_at >= ?');
        params.push(Number(since) || 0);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const rows = getDb().prepare(`
        SELECT id, created_at, user_id, user_name, action, target_type, target_id, details
        FROM audit_log
        ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);

    return rows.map(row => {
        let details = null;
        if (row.details) {
            try {
                details = JSON.parse(row.details);
            } catch {
                details = row.details;
            }
        }
        return { ...row, details };
    });
}

module.exports = { audit, listAuditLogs };
