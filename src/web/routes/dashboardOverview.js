// FIX DÉCROCHÉS + CARDS 22/05/2026
// CCV5 21/05/2026 — palette stricte + cards cliquables + fix
// COMMAND CENTER v4 20/05/2026 — refonte fidèle mockup
const log = require('../../shared/logger');
const { createConnection } = require('../../shared/database');
const { buildDashboardOverview } = require('../services/dashboardOverview');
const {
    buildPresenceDetail,
    getAbsencesWeek,
    getCraftsOpen,
    getDecrochesToday,
    getMembersList,
    getWeaponsOnSale,
} = require('../services/dashboardLists');

function registerDashboardOverviewRoutes(app, deps) {
    const {
        requireAuth,
        getBotClient,
        getBotState,
    } = deps;

    function withDb(res, action, errorLabel) {
        let db;
        try {
            db = createConnection();
            res.json(action(db));
        } catch (error) {
            log.error(`${errorLabel}:`, error.message);
            res.status(500).json({ error: 'Erreur serveur' });
        } finally {
            db?.close?.();
        }
    }

    app.get('/api/dashboard/overview', requireAuth, async (req, res) => {
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

    app.get('/api/dashboard/members-list', requireAuth, async (req, res) => {
        try {
            res.json({ members: getMembersList(getBotClient(), getBotState()) });
        } catch (error) {
            log.error('Erreur /api/dashboard/members-list:', error.message);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    app.get('/api/dashboard/weapons-on-sale', requireAuth, (req, res) => {
        withDb(res, db => ({ weapons: getWeaponsOnSale(db) }), 'Erreur /api/dashboard/weapons-on-sale');
    });

    app.get('/api/dashboard/absences-week', requireAuth, (req, res) => {
        withDb(res, db => ({ absences: getAbsencesWeek(db) }), 'Erreur /api/dashboard/absences-week');
    });

    app.get('/api/dashboard/crafts-open', requireAuth, (req, res) => {
        withDb(res, db => ({ crafts: getCraftsOpen(db) }), 'Erreur /api/dashboard/crafts-open');
    });

    app.get('/api/dashboard/decroches-today', requireAuth, (req, res) => {
        try {
            res.json(getDecrochesToday(getBotClient(), getBotState()));
        } catch (error) {
            log.error('Erreur /api/dashboard/decroches-today:', error.message);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });

    app.get('/api/dashboard/presence-detail', requireAuth, (req, res) => {
        try {
            res.json(buildPresenceDetail(getBotClient(), getBotState()));
        } catch (error) {
            log.error('Erreur /api/dashboard/presence-detail:', error.message);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });
}

module.exports = { registerDashboardOverviewRoutes };
