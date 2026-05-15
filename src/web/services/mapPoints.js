// FINAL POST-STAB A 17/05/2026 ? pino backend
const log = require('../../shared/logger');
// STABILISATION 15/05/2026 — migration carte SQLite
const fs = require('fs');
const path = require('path');
const config = require('../../shared/config');
const { createConnection } = require('../../shared/database');

const MAP_POINTS_FILE = path.join(config.paths.data, 'map_points.json');
const MIGRATED_FILE = `${MAP_POINTS_FILE}.migrated`;

let db = null;
let migrated = false;

function getDb() {
    if (db) return db;
    db = createConnection(config.paths.database);
    db.exec(`
        CREATE TABLE IF NOT EXISTS map_points (
            id TEXT PRIMARY KEY,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            label TEXT,
            color TEXT,
            role_id TEXT,
            user_id TEXT,
            is_lab INTEGER DEFAULT 0,
            type TEXT,
            code TEXT,
            allowed_roles_json TEXT DEFAULT '[]',
            allowed_users_json TEXT DEFAULT '[]',
            created_by TEXT,
            created_by_id TEXT,
            updated_by TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    migrateJsonOnce();
    return db;
}

function safeJsonParse(value, fallback) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizePoint(point = {}) {
    const allowedRoles = Array.isArray(point.allowedRoles)
        ? point.allowedRoles
        : safeJsonParse(point.allowed_roles_json || '[]', []);
    const allowedUsers = Array.isArray(point.allowedUsers)
        ? point.allowedUsers
        : safeJsonParse(point.allowed_users_json || '[]', []);
    const x = Number(point.x ?? point.lat ?? 0);
    const y = Number(point.y ?? point.lng ?? 0);
    return {
        id: String(point.id),
        x,
        y,
        lat: x,
        lng: y,
        label: point.label || 'Point',
        type: point.type || (point.is_lab ? 'weapon-lab' : 'weed'),
        color: point.color || null,
        code: point.code || null,
        allowedRoles,
        allowedUsers,
        createdBy: point.createdBy || point.created_by || null,
        createdById: point.createdById || point.created_by_id || null,
        updatedBy: point.updatedBy || point.updated_by || null,
        createdAt: Number(point.createdAt || point.created_at || Date.now()),
        updatedAt: Number(point.updatedAt || point.updated_at || point.createdAt || point.created_at || Date.now()),
    };
}

function rowToPoint(row) {
    return normalizePoint(row);
}

function insertRow(point) {
    const p = normalizePoint(point);
    getDb().prepare(`
        INSERT OR REPLACE INTO map_points (
            id, lat, lng, label, color, role_id, user_id, is_lab, type, code,
            allowed_roles_json, allowed_users_json, created_by, created_by_id, updated_by,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        p.id,
        p.lat,
        p.lng,
        p.label,
        p.color,
        p.allowedRoles[0] || null,
        p.allowedUsers[0] || null,
        ['lab', 'weapon-lab'].includes(p.type) ? 1 : 0,
        p.type,
        p.code,
        JSON.stringify(p.allowedRoles),
        JSON.stringify(p.allowedUsers),
        p.createdBy,
        p.createdById,
        p.updatedBy,
        p.createdAt,
        p.updatedAt
    );
    return p;
}

function migrateJsonOnce() {
    if (migrated) return;
    migrated = true;
    if (!fs.existsSync(MAP_POINTS_FILE) || fs.existsSync(MIGRATED_FILE)) return;
    try {
        const raw = JSON.parse(fs.readFileSync(MAP_POINTS_FILE, 'utf8'));
        const points = Array.isArray(raw) ? raw : [];
        const tx = db.transaction(() => {
            for (const point of points) insertRow(point);
        });
        tx();
        fs.renameSync(MAP_POINTS_FILE, MIGRATED_FILE);
        log.info(`🗺️ map_points.json migré vers SQLite (${points.length} point(s))`);
    } catch (e) {
        log.error('❌ Migration map_points.json échouée:', e.message);
    }
}

function listAll() {
    return getDb().prepare('SELECT * FROM map_points ORDER BY created_at ASC').all().map(rowToPoint);
}

function insert(point) {
    return insertRow({
        ...point,
        createdAt: point.createdAt || Date.now(),
        updatedAt: point.updatedAt || Date.now(),
    });
}

function update(id, fields) {
    const existing = listAll().find(point => point.id === String(id));
    if (!existing) return null;
    const updated = insertRow({
        ...existing,
        ...fields,
        id: existing.id,
        updatedAt: Date.now(),
    });
    return updated;
}

function deleteById(id) {
    const result = getDb().prepare('DELETE FROM map_points WHERE id = ?').run(String(id));
    return result.changes > 0;
}

module.exports = {
    listAll,
    insert,
    update,
    deleteById,
};
