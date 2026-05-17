// ROLES MAP VIEW 18/05/2026 — accès lecture seule carte (sans labs armes)
// MODIFIÉ CHANTIER 4 — 14/05/2026 — constantes permissions centralisées

const ADMIN_USER_ID = '952986899667103804'; // Otelow
const ADMIN_ROLE_ID = '1485279148246175764'; // Super admin / haut gradé

const FULL_ACCESS_ROLES = [
    '1485279148246175764', // Super admin
    '1486744891848654988', // Haut gradé
    '1485279534650494976', // Haut gradé
];

const LIMITED_CRAFT_ACCESS_ROLES = [
    '1495448653945634987', // Accès limité Craft/Vos Armes
];

// Rôles autorisés à VOIR la carte (lecture seule, sans les labs armes).
// Inclut les hauts gradés + 2 rôles spécifiques restreints à la carte.
const MAP_VIEW_ROLES = [
    ...FULL_ACCESS_ROLES,
    '1485636099853516982',
    '1485270431291277383',
];

function canViewMap(user) {
    if (!user) return false;
    if (user.id === ADMIN_USER_ID) return true;
    const roles = user.roles || [];
    return MAP_VIEW_ROLES.some(r => roles.includes(r));
}

const CRAFT_VALIDATION_ROLES = [...FULL_ACCESS_ROLES];
const LAB_VISIBLE_USERS = [
    '952986899667103804',
    '780164840798552066',
    '769670622380294265',
];

const MY_WEAPONS_DELETE_ROLE = '1490361524408291459';

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
};
