// COMMAND CENTER v4 20/05/2026 — refonte fidèle mockup
const log = require('../../shared/logger');
const { buildDashboardOverview } = require('../services/dashboardOverview');

function registerDashboardOverviewRoutes(app, deps) {
    const {
        requireAuth,
        requireFullSiteAccess,
        getBotClient,
        getBotState,
    } = deps;

    app.get('/api/dashboard/overview', requireAuth, requireFullSiteAccess, async (req, res) => {
        try {
            const data = await buildDashboardOverview({
                client: getBotClient(),
                state: getBotState(),
            });
            res.json(data);
        } catch (error) {
            log.error('Erreur /api/dashboard/overview:', error.message);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });
}

module.exports = { registerDashboardOverviewRoutes };
