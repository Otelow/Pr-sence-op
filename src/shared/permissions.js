// ROLE CLEANUP 31/05/2026 — role obsolete retire des permissions
// ROLES MAP VIEW 18/05/2026 — acces lecture seule carte (sans labs armes)
// MODIFIE CHANTIER 4 — 14/05/2026 — constantes permissions centralisees
const config = require('./config');

const ADMIN_USER_ID = config.permissions.adminUserId;
const ADMIN_ROLE_ID = config.permissions.adminRoleId;
const FULL_ACCESS_ROLES = config.permissions.fullAccessRoles;
const LIMITED_CRAFT_ACCESS_ROLES = config.permissions.limitedCraftAccessRoles;
const MAP_VIEW_ROLES = config.permissions.mapViewRoles;
const CRAFT_VALIDATION_ROLES = [...FULL_ACCESS_ROLES];
const LAB_VISIBLE_USERS = config.permissions.labVisibleUsers;
const MY_WEAPONS_DELETE_ROLE = config.permissions.myWeaponsDeleteRole;

function canViewMap(user) {
    if (!user) return false;
    if (user.id === ADMIN_USER_ID) return true;
    const roles = user.roles || [];
    return MAP_VIEW_ROLES.some(r => roles.includes(r));
}

function canSeeMapLabs(user) {
    if (!user) return false;
    if (LAB_VISIBLE_USERS.includes(user.id)) return true;
    const roles = user.roles || [];
    return FULL_ACCESS_ROLES.some(r => roles.includes(r));
}

module.exports = {
    ADMIN_USER_ID,
    ADMIN_ROLE_ID,
    FULL_ACCESS_ROLES,
    LIMITED_CRAFT_ACCESS_ROLES,
    MAP_VIEW_ROLES,
    CRAFT_VALIDATION_ROLES,
    LAB_VISIBLE_USERS,
    MY_WEAPONS_DELETE_ROLE,
    canViewMap,
    canSeeMapLabs,
};
