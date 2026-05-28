// ROLES MAP VIEW 18/05/2026 — accès lecture seule carte (sans labs armes)
// STABILISATION 15/05/2026 — carte persistée en SQLite
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes carte isolées
// AUDIT HOOKS 16/05/2026 — points carte tracés dans audit_log
const {
    FULL_ACCESS_ROLES,
    LAB_VISIBLE_USERS,
} = require('../../shared/permissions');
const mapPoints = require('../services/mapPoints');
const { audit } = require('../../shared/auditLog');

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function normalizeIdArray(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(v => /^\d{15,25}$/.test(v));
}

function registerMapRoutes(app, deps) {
    const {
        requireAuth,
        requireMapViewAccess,
        isUserAdmin,
        canEditMapUser,
    } = deps;

    function canEditMap(req) {
        return canEditMapUser(req.session.user);
    }

    app.get('/api/map/points', requireAuth, requireMapViewAccess, (req, res) => {
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

        const visiblePoints = mapPoints.listAll().filter(p => {
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
        if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
            return res.status(400).json({ error: 'Coordonnées invalides' });
        }

        const point = mapPoints.insert({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            x,
            y,
            label: label || 'Point',
            type: type || 'weed',
            code: ['lab', 'weapon-lab'].includes(type) ? (code || '').trim().slice(0, 50) : null,
            allowedRoles: normalizeIdArray(allowedRoles),
            allowedUsers: normalizeIdArray(allowedUsers),
            createdBy: req.session.user.username,
            createdById: req.session.user.id,
            createdAt: Date.now(),
        });
        audit(req.session.user, 'mapPoint.create', {
            target_type: 'map_point',
            target_id: point.id,
            details: { x, y, label: point.label, type: point.type, color: point.color || null },
        });
        res.json({ success: true, point });
    });

    app.delete('/api/map/points/:id', requireAuth, (req, res) => {
        if (!canEditMap(req)) return res.status(403).json({ error: 'Permissions insuffisantes' });

        if (!mapPoints.deleteById(req.params.id)) return res.status(404).json({ error: 'Point introuvable' });
        audit(req.session.user, 'mapPoint.delete', {
            target_type: 'map_point',
            target_id: req.params.id,
        });
        res.json({ success: true });
    });

    app.put('/api/map/points/:id', requireAuth, (req, res) => {
        if (!canEditMap(req)) return res.status(403).json({ error: 'Permissions insuffisantes' });

        const point = mapPoints.listAll().find(p => p.id === req.params.id);
        if (!point) return res.status(404).json({ error: 'Point introuvable' });

        const { x, y, label, type, color, code, allowedRoles, allowedUsers } = req.body;
        if (x !== undefined) {
            if (!isFiniteNumber(x)) return res.status(400).json({ error: 'Coordonnée x invalide' });
            point.x = x;
        }
        if (y !== undefined) {
            if (!isFiniteNumber(y)) return res.status(400).json({ error: 'Coordonnée y invalide' });
            point.y = y;
        }
        if (label !== undefined) point.label = label;
        if (type !== undefined) point.type = type;
        if (color !== undefined) point.color = color;
        if (code !== undefined && ['lab', 'weapon-lab'].includes(point.type)) {
            point.code = (code || '').trim().slice(0, 50);
        }
        if (Array.isArray(allowedRoles)) point.allowedRoles = normalizeIdArray(allowedRoles);
        if (Array.isArray(allowedUsers)) point.allowedUsers = normalizeIdArray(allowedUsers);
        point.updatedBy = req.session.user.username;

        const updatedPoint = mapPoints.update(req.params.id, point);
        audit(req.session.user, 'mapPoint.update', {
            target_type: 'map_point',
            target_id: req.params.id,
            details: { x, y, label, type, color, allowedRoles: point.allowedRoles, allowedUsers: point.allowedUsers },
        });
        res.json({ success: true, point: updatedPoint });
    });
}

module.exports = {
    registerMapRoutes,
    isFiniteNumber,
    normalizeIdArray,
};
