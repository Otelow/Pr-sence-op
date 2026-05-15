// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes admin clips isolées
// AUDIT HOOKS 16/05/2026 — actions admin clips tracées dans audit_log
const {
    backfillClipForum,
    getBackfillStatus,
    getRecentClipBackups,
    retryFailedClipBackups,
} = require('../../shared/clipBackup');
const { audit } = require('../../shared/auditLog');

function registerAdminClipRoutes(app, { requireAdmin, getBotClient }) {
    app.post('/api/admin/clips/backfill', requireAdmin, async (req, res) => {
        try {
            const botClient = getBotClient();
            if (!botClient?.isReady?.()) {
                return res.status(503).json({ error: 'Bot Discord non pret pour le backfill clips' });
            }
            backfillClipForum(botClient).catch(e => console.error(`[clips] backfill background echoue: ${e.message}`));
            audit(req.session.user, 'clips.backfill', {
                target_type: 'system',
                details: { status: getBackfillStatus() },
            });
            res.json({ success: true, status: getBackfillStatus() });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/clips/backfill/status', requireAdmin, (req, res) => {
        try {
            res.json({ status: getBackfillStatus() });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/clip-backups', requireAdmin, (req, res) => {
        try {
            res.json({ clips: getRecentClipBackups(req.query.limit) });
        } catch (e) {
            res.status(500).json({ clips: [], error: e.message });
        }
    });

    app.post('/api/admin/clips/retry-failed', requireAdmin, async (req, res) => {
        try {
            const botClient = getBotClient();
            if (!botClient?.isReady?.()) {
                return res.status(503).json({ error: 'Bot Discord non pret pour retenter les clips' });
            }
            const summary = await retryFailedClipBackups(botClient, req.body?.limit || req.query.limit);
            audit(req.session.user, 'clips.retryFailed', {
                target_type: 'system',
                details: { limit: req.body?.limit || req.query.limit || null, summary },
            });
            res.json({ success: true, summary });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
}

module.exports = { registerAdminClipRoutes };
