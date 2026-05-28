// ROLES MAP VIEW 18/05/2026 — accès lecture seule carte (sans labs armes)
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes config utilisateur isolées
const {
    ADMIN_USER_ID,
    ADMIN_ROLE_ID,
    FULL_ACCESS_ROLES,
    LIMITED_CRAFT_ACCESS_ROLES,
    MAP_VIEW_ROLES,
    LAB_VISIBLE_USERS,
    MY_WEAPONS_DELETE_ROLE,
    canViewMap,
} = require('../../shared/permissions');
const { ensureCsrfToken } = require('../middlewares/csrf');

function registerConfigRoutes(app, deps) {
    const {
        requireAuth,
        isUserAdmin,
        hasFullSiteAccess,
        hasLimitedCraftAccess,
        canAccessCrafts,
        canAccessMyWeapons,
        canEditMapUser,
    } = deps;

    app.get('/api/me', requireAuth, (req, res) => {
        const user = {
            ...req.session.user,
            csrfToken: ensureCsrfToken(req),
            isAdmin: isUserAdmin(req.session.user),
            hasFullSiteAccess: hasFullSiteAccess(req.session.user),
            hasLimitedCraftAccess: hasLimitedCraftAccess(req.session.user),
            canAccessCrafts: canAccessCrafts(req.session.user),
            canAccessMyWeapons: canAccessMyWeapons(req.session.user),
            canViewMap: canViewMap(req.session.user),
        };
        res.json(user);
    });

    app.get('/api/config/public', requireAuth, (req, res) => {
        res.json({
            adminUserId: ADMIN_USER_ID,
            adminRoleId: ADMIN_ROLE_ID,
            fullAccessRoles: FULL_ACCESS_ROLES,
            limitedCraftAccessRoles: LIMITED_CRAFT_ACCESS_ROLES,
            mapViewRoles: MAP_VIEW_ROLES,
            labVisibleUsers: LAB_VISIBLE_USERS,
            myWeaponsDeleteRole: MY_WEAPONS_DELETE_ROLE,
        });
    });

    app.get('/api/me/permissions', requireAuth, (req, res) => {
        res.json({
            csrfToken: ensureCsrfToken(req),
            canEditMap: canEditMapUser(req.session.user),
            isAdmin: isUserAdmin(req.session.user),
            hasFullSiteAccess: hasFullSiteAccess(req.session.user),
            hasLimitedCraftAccess: hasLimitedCraftAccess(req.session.user),
            canAccessCrafts: canAccessCrafts(req.session.user),
            canAccessMyWeapons: canAccessMyWeapons(req.session.user),
            canViewMap: canViewMap(req.session.user),
        });
    });

    app.get('/api/admin/check', requireAuth, (req, res) => {
        res.json({ isAdmin: isUserAdmin(req.session.user), csrfToken: ensureCsrfToken(req) });
    });

    app.get('/api/csrf', requireAuth, (req, res) => {
        res.json({ csrfToken: ensureCsrfToken(req) });
    });
}

module.exports = { registerConfigRoutes };
