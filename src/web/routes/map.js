// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes carte isolées
const fs = require('fs');
const path = require('path');
const config = require('../../shared/config');
const {
    FULL_ACCESS_ROLES,
    LAB_VISIBLE_USERS,
} = require('../../shared/permissions');

fs.mkdirSync(config.paths.data, { recursive: true });
const MAP_POINTS_FILE = path.join(config.paths.data, 'map_points.json');

function loadMapPoints() {
    try {
        if (fs.existsSync(MAP_POINTS_FILE)) {
            return JSON.parse(fs.readFileSync(MAP_POINTS_FILE, 'utf8'));
        }
    } catch {}
    return [];
}

function saveMapPoints(points) {
    try {
        fs.writeFileSync(MAP_POINTS_FILE, JSON.stringify(points, null, 2));
    } catch (e) {
        console.error('❌ Erreur sauvegarde map points:', e.message);
    }
}

function registerMapRoutes(app, deps) {
    const {
        requireAuth,
        requireFullSiteAccess,
        isUserAdmin,
        canEditMapUser,
    } = deps;

    function canEditMap(req) {
        return canEditMapUser(req.session.user);
    }

    app.get('/api/map/points', requireAuth, requireFullSiteAccess, (req, res) => {
        const userId = req.session.user?.id;
        const userRoles = req.session.user?.roles || [];

        const impersonateRole = req.query.impersonate;
        const isAdmin = isUserAdmin(req.session.user);
        const isImpersonating = !!impersonateRole && isAdmin;
        const effectiveUserId = isImpersonating ? '__impersonate__' : userId;
        const effectiveRoles = isImpersonating ? [impersonateRole] : userRoles;

        const canSeeLab = isImpersonating
            ? FULL_ACCESS_ROLES.includes(impersonateRole)
            : (
                LAB_VISIBLE_USERS.includes(userId) ||
                FULL_ACCESS_ROLES.some(r => userRoles.includes(r))
            );

        const allPoints = loadMapPoints();
        const visiblePoints = allPoints.filter(p => {
            if (p.type === 'weapon-lab') return canSeeLab;

            if ((!p.allowedRoles || p.allowedRoles.length === 0) &&
                (!p.allowedUsers || p.allowedUsers.length === 0)) {
                return true;
            }

            if (p.allowedUsers && p.allowedUsers.length > 0) {
                if (p.allowedUsers.includes(effectiveUserId)) return true;
            }

            if (p.allowedRoles && p.allowedRoles.length > 0) {
                return p.allowedRoles.some(r => effectiveRoles.includes(r));
            }

            return false;
        });

        res.json({ points: visiblePoints, impersonating: isImpersonating });
    });

    app.post('/api/map/points', requireAuth, (req, res) => {
        if (!canEditMap(req)) return res.status(403).json({ error: 'Permissions insuffisantes pour modifier la carte' });

        const { x, y, label, type, allowedRoles, allowedUsers, code } = req.body;
        if (typeof x !== 'number' || typeof y !== 'number') {
            return res.status(400).json({ error: 'Coordonnées invalides' });
        }

        const points = loadMapPoints();
        const point = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            x,
            y,
            label: label || 'Point',
            type: type || 'weed',
            code: ['lab', 'weapon-lab'].includes(type) ? (code || '').trim().slice(0, 50) : null,
            allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [],
            allowedUsers: Array.isArray(allowedUsers) ? allowedUsers : [],
            createdBy: req.session.user.username,
            createdById: req.session.user.id,
            createdAt: Date.now(),
        };
        points.push(point);
        saveMapPoints(points);
        res.json({ success: true, point });
    });

    app.delete('/api/map/points/:id', requireAuth, (req, res) => {
        if (!canEditMap(req)) return res.status(403).json({ error: 'Permissions insuffisantes' });

        const points = loadMapPoints();
        const filtered = points.filter(p => p.id !== req.params.id);
        if (filtered.length === points.length) return res.status(404).json({ error: 'Point introuvable' });
        saveMapPoints(filtered);
        res.json({ success: true });
    });

    app.put('/api/map/points/:id', requireAuth, (req, res) => {
        if (!canEditMap(req)) return res.status(403).json({ error: 'Permissions insuffisantes' });

        const points = loadMapPoints();
        const point = points.find(p => p.id === req.params.id);
        if (!point) return res.status(404).json({ error: 'Point introuvable' });

        const { x, y, label, type, color, code, allowedRoles } = req.body;
        if (typeof x === 'number') point.x = x;
        if (typeof y === 'number') point.y = y;
        if (label !== undefined) point.label = label;
        if (type !== undefined) point.type = type;
        if (color !== undefined) point.color = color;
        if (code !== undefined && ['lab', 'weapon-lab'].includes(point.type)) {
            point.code = (code || '').trim().slice(0, 50);
        }
        if (Array.isArray(allowedRoles)) point.allowedRoles = allowedRoles;
        point.updatedAt = Date.now();
        point.updatedBy = req.session.user.username;

        saveMapPoints(points);
        res.json({ success: true, point });
    });
}

module.exports = {
    registerMapRoutes,
    loadMapPoints,
    saveMapPoints,
};
