// STABILISATION 15/05/2026 — corrections runtime post-audit
// MODIFIÉ CHANTIER 6 — 14/05/2026 — middlewares auth/permissions web isolés
const {
    ADMIN_USER_ID,
    FULL_ACCESS_ROLES,
    LIMITED_CRAFT_ACCESS_ROLES,
} = require('../../shared/permissions');

function requireAuth(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
    next();
}

function isUserAdmin(user) {
    if (!user) return false;
    if (user.id === ADMIN_USER_ID) return true;
    return !!(user.roles && FULL_ACCESS_ROLES.some(roleId => user.roles.includes(roleId)));
}

function hasFullSiteAccess(user) {
    if (!user) return false;
    if (user.id === ADMIN_USER_ID) return true;
    return FULL_ACCESS_ROLES.some(roleId => (user.roles || []).includes(roleId));
}

function hasLimitedCraftAccess(user) {
    if (!user) return false;
    return LIMITED_CRAFT_ACCESS_ROLES.some(roleId => (user.roles || []).includes(roleId));
}

function canAccessCrafts(user) {
    return hasFullSiteAccess(user) || hasLimitedCraftAccess(user);
}

function canAccessMyWeapons(user) {
    return hasFullSiteAccess(user) || hasLimitedCraftAccess(user);
}

function canEditMapUser(user) {
    return hasFullSiteAccess(user);
}

function requireFullSiteAccess(req, res, next) {
    if (!hasFullSiteAccess(req.session.user)) {
        return res.status(403).json({ error: 'Accès confidentiel réservé aux hauts gradés' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
    if (!isUserAdmin(req.session.user)) return res.status(403).json({ error: 'Accès admin requis' });
    next();
}

module.exports = {
    requireAuth,
    requireAdmin,
    requireFullSiteAccess,
    isUserAdmin,
    hasFullSiteAccess,
    hasLimitedCraftAccess,
    canAccessCrafts,
    canAccessMyWeapons,
    canEditMapUser,
};
