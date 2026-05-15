// FINAL D3 16/05/2026 — endpoint monitoring admin détaillé
const fs = require('fs');
const path = require('path');
const { createConnection } = require('../../shared/database');
const config = require('../../shared/config');

function registerHealthDetailedRoutes(app, { requireAdmin, getBotClient, getRealtimeServer }) {
    app.get('/api/admin/health-detailed', requireAdmin, (req, res) => {
        const botClient = getBotClient?.();
        const realtime = getRealtimeServer?.();
        const mem = process.memoryUsage();

        let dbSize = 0;
        try {
            dbSize = fs.statSync(config.paths.database).size;
        } catch {}

        const tableStats = [];
        let db;
        try {
            db = createConnection(config.paths.database);
            const tables = [
                'my_weapons',
                'craft_requests',
                'order_advances',
                'order_advance_items',
                'audit_log',
                'map_points',
                'bot_state',
                'schema_migrations',
            ];
            for (const table of tables) {
                try {
                    const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
                    tableStats.push({ name: table, rows: row?.c || 0 });
                } catch {}
            }
        } catch {
            // Monitoring non critique : on renvoie juste les métriques disponibles.
        } finally {
            try { db?.close?.(); } catch {}
        }

        let backupsCount = 0;
        let backupsLast = null;
        try {
            const backupDir = path.join(config.paths.data, 'backups');
            const files = fs.readdirSync(backupDir).filter(file => file.endsWith('.db'));
            backupsCount = files.length;
            if (files.length) {
                const latest = files
                    .map(file => ({
                        file,
                        mtimeMs: fs.statSync(path.join(backupDir, file)).mtimeMs,
                    }))
                    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
                backupsLast = new Date(latest.mtimeMs).toISOString();
            }
        } catch {}

        res.json({
            uptime_seconds: Math.round(process.uptime()),
            memory_heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
            memory_rss_mb: Math.round(mem.rss / 1024 / 1024),
            bot_ready: botClient?.isReady?.() ?? false,
            bot_ping_ms: botClient?.ws?.ping ?? null,
            ws_clients: realtime?.engine?.clientsCount ?? 0,
            db_size_kb: Math.round(dbSize / 1024),
            db_tables: tableStats,
            backups_count: backupsCount,
            backups_last: backupsLast,
            version: require('../../../package.json').version,
            node_version: process.version,
        });
    });
}

module.exports = { registerHealthDetailedRoutes };
