// QUICK WINS 1 18/05/2026 — notifications audit temps réel
// QUICK WINS 2 18/05/2026 — export CSV audit log
// ONGLET HISTORIQUE 16/05/2026 — pagination et filtres audit log
// STABILISATION FINALE v2 16/05/2026 — utilitaire audit log admin SQLite
const { createConnection } = require('./database');
const config = require('./config');
const log = require('./logger');
const { emitRealtime } = require('./realtime');

let db;

function getDb() {
    if (!db) db = createConnection(config.paths.database);
    return db;
}

function truncateSummary(value, max = 60) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function summarizeDetails(action, details = {}) {
    if (!details || typeof details !== 'object') return '';
    switch (action) {
        case 'sanction.add':
            return truncateSummary(details.reason);
        case 'craft.request.validate':
        case 'craft.request.create':
            return truncateSummary(details.weapon_name || details.weaponName);
        case 'weapon.markSold':
        case 'weapon.markSold.byAdmin':
            return truncateSummary(`${details.weapon_name || details.name || 'Arme'}${details.buyer ? ` → ${details.buyer}` : ''}`);
        case 'order.create':
        case 'order.update':
            return truncateSummary(details.total_amount ? `Commande ${Number(details.total_amount).toLocaleString('fr-FR')} $` : 'Commande');
        case 'mapPoint.create':
        case 'mapPoint.update':
            return truncateSummary(details.label);
        default:
            return '';
    }
}

function audit(user, action, opts = {}) {
    const { target_type, target_id, details } = opts;
    try {
        const result = getDb().prepare(`
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

        if (action !== 'audit.read') {
            emitRealtime('audit:new', {
                id: result.lastInsertRowid,
                action,
                user_name: user?.username || user?.name || 'Inconnu',
                target_type: target_type || null,
                target_id: target_id !== undefined && target_id !== null ? String(target_id) : null,
                details_summary: summarizeDetails(action, details),
                created_at: Math.floor(Date.now() / 1000),
            });
        }
    } catch (e) {
        log.warn({ err: e.message, action }, 'audit log écriture échouée');
    }
}

function buildAuditWhere({ action, user_id, since } = {}) {
    const clauses = [];
    const params = [];

    if (action) {
        clauses.push('action LIKE ?');
        params.push(`${String(action)}%`);
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
    return { where, params };
}

function normalizeAuditDetails(row) {
    let details = null;
    if (row.details) {
        try {
            details = JSON.parse(row.details);
        } catch {
            details = row.details;
        }
    }
    return { ...row, details };
}

function listAuditLogs({ limit = 100, offset = 0, action, user_id, since } = {}) {
    const { where, params } = buildAuditWhere({ action, user_id, since });
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const rows = getDb().prepare(`
        SELECT id, created_at, user_id, user_name, action, target_type, target_id, details
        FROM audit_log
        ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);

    return rows.map(normalizeAuditDetails);
}

function exportAuditLogs({ limit = 10000, action, user_id, since } = {}) {
    const { where, params } = buildAuditWhere({ action, user_id, since });
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10000, 1), 10000);
    return getDb().prepare(`
        SELECT id, created_at, user_id, user_name, action, target_type, target_id, details
        FROM audit_log
        ${where}
        ORDER BY created_at DESC
        LIMIT ?
    `).all(...params, safeLimit);
}

function countAuditLogs({ action, user_id, since } = {}) {
    const { where, params } = buildAuditWhere({ action, user_id, since });
    const row = getDb().prepare(`
        SELECT COUNT(*) as total
        FROM audit_log
        ${where}
    `).get(...params);
    return Number(row?.total) || 0;
}

function queryAuditLogs(filters = {}) {
    return {
        total: countAuditLogs(filters),
        logs: listAuditLogs(filters),
    };
}

module.exports = {
    audit,
    listAuditLogs,
    exportAuditLogs,
    countAuditLogs,
    queryAuditLogs,
    summarizeDetails,
};
