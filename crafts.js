// ==========================================
// MODULE CRAFTS — DB SQLite
// MODIFIÉ CHANTIER 3 — 14/05/2026 — images craft protégées par session
// MODIFIÉ CHANTIER 4 — 14/05/2026 — rôles craft centralisés
// MODIFIÉ CHANTIER 5 — 14/05/2026 — suppression du fallback JSON
// MODIFIÉ CHANTIER 12 — 14/05/2026 — events temps réel craft/dashboard
// MODIFIE CHANTIER 6 - 14/05/2026 - routes craft extraites en modules web
// ==========================================
const path = require('path');
const fs = require('fs');
const config = require('./src/shared/config');
const { ensureDataDirs } = require('./src/shared/database');
const {
    ADMIN_USER_ID,
    ADMIN_ROLE_ID,
    CRAFT_VALIDATION_ROLES,
    LIMITED_CRAFT_ACCESS_ROLES,
    MY_WEAPONS_DELETE_ROLE,
} = require('./src/shared/permissions');
const { emitRealtime } = require('./src/shared/realtime');
const { createCatalogService } = require('./src/web/services/crafts/catalog');
const { createCraftUploadMiddleware } = require('./src/web/services/crafts/uploads');
const { createOrderAdvanceService } = require('./src/web/services/crafts/orderAdvances');
const { createCraftRequestService } = require('./src/web/services/crafts/requests');
const { createStockService } = require('./src/web/services/crafts/stock');
const { registerCraftCatalogRoutes } = require('./src/web/routes/crafts/catalog');
const { registerOrderAdvanceRoutes } = require('./src/web/routes/crafts/orderAdvances');
const { registerCraftRequestRoutes } = require('./src/web/routes/crafts/requests');
const { registerMyWeaponsRoutes } = require('./src/web/routes/crafts/myWeapons');

const DATA_DIR = config.paths.data;
const DB_PATH = config.paths.database;
const UPLOADS_DIR = config.paths.craftsUploads;
const Database = require('better-sqlite3');
let db = null;
const upload = createCraftUploadMiddleware(UPLOADS_DIR);

const STOCK_MATERIAL_NAMES = [
    'Bloc de chrome',
    'Bloc de titane',
    'Bloc de tungstène',
    'Chrome',
    'Titane',
    'Tungstène',
];

function normalizeStockName(value) {
    return String(value || '')
        .replace(/è/g, 'e')
        .replace(/é/g, 'e')
        .replace(/ê/g, 'e')
        .replace(/ë/g, 'e')
        .replace(/à/g, 'a')
        .replace(/â/g, 'a')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^stock\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function getCanonicalStockMaterialName(name) {
    const normalized = normalizeStockName(name);
    return STOCK_MATERIAL_NAMES.find(material => normalizeStockName(material) === normalized) || null;
}

function isStockMaterialName(name) {
    return Boolean(getCanonicalStockMaterialName(name));
}

const CRAFT_PRODUCTION_STATUSES = ['materials', 'waiting_materials', 'in_progress', 'crafted'];
const CRAFT_STOCK_RESERVED_STATUSES = ['materials', 'waiting_materials', 'in_progress'];

function initDB() {
            try {
            db = new Database(DB_PATH);
            db.pragma('journal_mode = WAL');
            db.pragma('foreign_keys = ON');
            db.pragma('busy_timeout = 5000');
            db.exec(`
                CREATE TABLE IF NOT EXISTS weapons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    image_path TEXT,
                    plan_image_path TEXT,
                    requires_plan INTEGER DEFAULT 0,
                    craft_time INTEGER DEFAULT 0,
                    craft_price INTEGER DEFAULT 0,
                    sale_price INTEGER DEFAULT 0,
                    max_sale_price INTEGER DEFAULT 0,
                    ingredients TEXT DEFAULT '[]',
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE TABLE IF NOT EXISTS ingredients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    image_path TEXT,
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE TABLE IF NOT EXISTS stock_materials (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ingredient_id INTEGER NOT NULL UNIQUE,
                    quantity INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER DEFAULT (strftime('%s','now')),
                    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS my_weapon_names (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    sale_price INTEGER DEFAULT 0,
                    max_sale_price INTEGER DEFAULT 0,
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE TABLE IF NOT EXISTS organizations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE TABLE IF NOT EXISTS craft_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL,
                    weapon_id INTEGER NOT NULL,
                    has_plan INTEGER DEFAULT 0,
                    has_money INTEGER DEFAULT 0,
                    request_type TEXT,
                    is_test INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'pending',
                    refusal_reason TEXT,
                    crafted INTEGER DEFAULT 0,
                    serial_number TEXT,
                    buyer_org TEXT,
                    sale_price INTEGER,
                    craft_date INTEGER,
                    sale_date INTEGER,
                    crafted_by_id TEXT,
                    crafted_by_name TEXT,
                    completed_by_id TEXT,
                    completed_by_name TEXT,
                    posted_to_channel INTEGER DEFAULT 0,
                    stock_consumed_at INTEGER,
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE TABLE IF NOT EXISTS my_weapons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL,
                    user_avatar TEXT,
                    weapon_name TEXT NOT NULL,
                    craft_request_id INTEGER,
                    is_crafted INTEGER DEFAULT 0,
                    serial_number TEXT,
                    asking_price INTEGER,
                    min_price INTEGER,
                    is_sold INTEGER DEFAULT 0,
                    sold_to TEXT,
                    sold_price INTEGER,
                    sold_at INTEGER,
                    crafted_by_id TEXT,
                    crafted_by_name TEXT,
                    sold_by_id TEXT,
                    sold_by_name TEXT,
                    discord_message_id TEXT,
                    weapons_log_message_id TEXT,
                    sale_discord_message_id TEXT,
                    created_by_id TEXT,
                    created_by_name TEXT,
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE TABLE IF NOT EXISTS order_advances (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    order_date TEXT,
                    total_amount INTEGER DEFAULT 0,
                    recovered_amount INTEGER DEFAULT 0,
                    remaining_amount INTEGER DEFAULT 0,
                    note TEXT,
                    status TEXT DEFAULT 'open',
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    updated_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE TABLE IF NOT EXISTS order_advance_participants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    user_id TEXT,
                    user_name TEXT NOT NULL,
                    amount_contributed INTEGER DEFAULT 0,
                    amount_recovered INTEGER DEFAULT 0,
                    amount_remaining INTEGER DEFAULT 0,
                    amount_to_compensate_next_order INTEGER DEFAULT 0,
                    note TEXT,
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    updated_at INTEGER DEFAULT (strftime('%s','now')),
                    FOREIGN KEY (order_id) REFERENCES order_advances(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS order_advance_repayments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    participant_id INTEGER,
                    user_id TEXT,
                    user_name TEXT,
                    amount INTEGER DEFAULT 0,
                    reason TEXT,
                    weapon_name TEXT,
                    repayment_date TEXT,
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    updated_at INTEGER DEFAULT (strftime('%s','now')),
                    FOREIGN KEY (order_id) REFERENCES order_advances(id) ON DELETE CASCADE,
                    FOREIGN KEY (participant_id) REFERENCES order_advance_participants(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_requests_status ON craft_requests(status);
                CREATE INDEX IF NOT EXISTS idx_requests_user ON craft_requests(user_id);
                CREATE INDEX IF NOT EXISTS idx_myweapons_user ON my_weapons(user_id);
                CREATE INDEX IF NOT EXISTS idx_stock_materials_ingredient ON stock_materials(ingredient_id);
                CREATE INDEX IF NOT EXISTS idx_order_repayments_order ON order_advance_repayments(order_id);
            `);

            // Migrations
            try { db.exec(`ALTER TABLE weapons ADD COLUMN plan_image_path TEXT`); } catch {}
            try { db.exec(`ALTER TABLE weapons ADD COLUMN requires_plan INTEGER DEFAULT 0`); } catch {}
            try { db.exec(`ALTER TABLE weapons ADD COLUMN sale_price INTEGER DEFAULT 0`); } catch {}
            try { db.exec(`ALTER TABLE weapons ADD COLUMN max_sale_price INTEGER DEFAULT 0`); } catch {}
            try { db.exec(`ALTER TABLE my_weapon_names ADD COLUMN sale_price INTEGER DEFAULT 0`); } catch {}
            try { db.exec(`ALTER TABLE my_weapon_names ADD COLUMN max_sale_price INTEGER DEFAULT 0`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN user_avatar TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN asking_price INTEGER`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN min_price INTEGER`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN is_sold INTEGER DEFAULT 0`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN sold_to TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN sold_price INTEGER`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN sold_at INTEGER`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN crafted_by_id TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN crafted_by_name TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN sold_by_id TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN sold_by_name TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN discord_message_id TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN weapons_log_message_id TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN sale_discord_message_id TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN batch_id TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN created_by_id TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN created_by_name TEXT`); } catch {}
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN craft_request_id INTEGER`); } catch {}
            try { db.exec(`ALTER TABLE craft_requests ADD COLUMN discord_message_id TEXT`); } catch {}
            try { db.exec(`ALTER TABLE craft_requests ADD COLUMN stock_consumed_at INTEGER`); } catch {}
            try { db.exec(`ALTER TABLE craft_requests ADD COLUMN request_type TEXT`); } catch {}
            try { db.exec(`ALTER TABLE craft_requests ADD COLUMN is_test INTEGER DEFAULT 0`); } catch {}
            try { db.exec(`ALTER TABLE craft_requests ADD COLUMN refusal_reason TEXT`); } catch {}
            try { db.exec(`CREATE INDEX IF NOT EXISTS idx_myweapons_craft_request ON my_weapons(craft_request_id)`); } catch {}

            const defaultIngredients = ['Tungstène', 'Bloc de tungstène', 'Bloc de chrome', 'Bloc de titane', 'Corps de Pistolet', 'Corps de Fusil à pompe', 'Corps de Mitraillette', 'Corps de Fusil'];
            for (const ing of defaultIngredients) {
                try { db.prepare('INSERT OR IGNORE INTO ingredients (name) VALUES (?)').run(ing); } catch {}
            }
            seedStockMaterials();
            seedMyWeaponNamesFromWeapons();

            console.log('💾 DB Crafts initialisée (SQLite)');
        } catch (e) {
            console.error('❌ SQLite init error, arrêt du module crafts:', e.message);
            throw e;
        }

}

function seedStockMaterials() {
            const insertIngredient = db.prepare('INSERT OR IGNORE INTO ingredients (name) VALUES (?)');
        const upsertStock = db.prepare(`
            INSERT INTO stock_materials (ingredient_id, quantity, updated_at)
            VALUES (?, ?, strftime('%s','now'))
            ON CONFLICT(ingredient_id) DO UPDATE SET
                quantity = excluded.quantity,
                updated_at = excluded.updated_at
        `);
        const stockByIngredient = db.prepare('SELECT * FROM stock_materials WHERE ingredient_id = ?');
        const deleteDuplicateStock = db.prepare('DELETE FROM stock_materials WHERE ingredient_id = ?');
        const updateIngredientName = db.prepare('UPDATE ingredients SET name = ? WHERE id = ?');

        for (const name of STOCK_MATERIAL_NAMES) {
            let allIngredients = db.prepare('SELECT * FROM ingredients').all();
            let matches = allIngredients.filter(item => normalizeStockName(item.name) === normalizeStockName(name));
            if (!matches.length) {
                insertIngredient.run(name);
                allIngredients = db.prepare('SELECT * FROM ingredients').all();
                matches = allIngredients.filter(item => normalizeStockName(item.name) === normalizeStockName(name));
            }
            const preferred = matches.find(item => item.image_path)
                || matches.find(item => item.name === name)
                || matches[0];
            if (!preferred) continue;
            if (preferred.name !== name) {
                try { updateIngredientName.run(name, preferred.id); } catch {}
            }

            let quantity = 0;
            for (const ingredient of matches) {
                const stock = stockByIngredient.get(ingredient.id);
                if (stock) quantity = Math.max(quantity, Number(stock.quantity) || 0);
            }
            upsertStock.run(preferred.id, quantity);
            for (const ingredient of matches) {
                if (Number(ingredient.id) !== Number(preferred.id)) deleteDuplicateStock.run(ingredient.id);
            }
        }
        invalidateCraftCaches();
}

function seedMyWeaponNamesFromWeapons() {
    try {
                    const existing = db.prepare('SELECT COUNT(*) as count FROM my_weapon_names').get();
            if (existing && existing.count > 0) return;
            const names = db.prepare("SELECT DISTINCT name FROM weapons WHERE name IS NOT NULL AND TRIM(name) != '' ORDER BY name ASC").all();
            const stmt = db.prepare('INSERT OR IGNORE INTO my_weapon_names (name) VALUES (?)');
            for (const row of names) stmt.run(String(row.name || '').trim());
    } catch (e) {
        console.error('Erreur seed noms armes vente:', e.message);
    }
}

let catalogService;
let getAllWeapons;
let getWeapon;
let getWeaponByName;
let insertWeapon;
let updateWeapon;
let deleteWeapon;
let getAllIngredients;
let getIngredient;
let insertIngredient;
let updateIngredient;
let deleteIngredient;
let getRequests;
let getRequest;
let normalizeCraftRequestType;
let insertRequest;
let updateRequestCraft;
let updateRequestSale;
let markRequestPosted;
let getWeaponSaleStateForCraftRequest;
let getLinkedMyWeaponsForRequest;
let serialAlreadyListed;
let getMyWeaponById;
let deleteRequest;
let deleteCraftRequestCleanly;

const {
    invalidateCraftCaches,
    toCraftImageUrl,
    getStockMaterials,
    getReservedStockByActiveRequests,
    createStockError,
    getStockRequirementsForWeapon,
    applyStockDelta,
    consumeStockForCraftRequest,
    restoreStockForCraftRequest,
    getAvailableStock,
    updateStockMaterial,
    getCraftableWeapons,
    parseWeaponIngredients,
} = createStockService({
    getDb: () => db,
    getAllWeapons: (...args) => getAllWeapons(...args),
    getAllIngredients: (...args) => getAllIngredients(...args),
    getIngredient: (...args) => getIngredient(...args),
    getWeapon: (...args) => getWeapon(...args),
    getRequests: (...args) => getRequests(...args),
    normalizeStockName,
    getCanonicalStockMaterialName,
    isStockMaterialName,
    stockMaterialNames: STOCK_MATERIAL_NAMES,
    reservedStatuses: CRAFT_STOCK_RESERVED_STATUSES,
});

({
    getAllWeapons,
    getWeapon,
    getWeaponByName,
    insertWeapon,
    updateWeapon,
    deleteWeapon,
    getAllIngredients,
    getIngredient,
    insertIngredient,
    updateIngredient,
    deleteIngredient,
    getAllMyWeaponNames,
    getMyWeaponNameByName,
    getAllMyWeaponNamesWithPriceLimits,
    insertMyWeaponName,
    updateMyWeaponName,
    deleteMyWeaponName,
    getAllOrgs,
    insertOrg,
    deleteOrg,
} = createCatalogService({
    getDb: () => db,
    invalidateCraftCaches: () => invalidateCraftCaches(),
    seedStockMaterials: () => seedStockMaterials(),
    isStockMaterialName,
}));

const {
    getOrderAdvances,
    upsertOrderAdvance,
    deleteOrderAdvance,
    settleOrderAdvance,
    saveOrderAdvanceRepayment,
    deleteOrderAdvanceRepayment,
} = createOrderAdvanceService({ getDb: () => db });

({
    getRequests,
    getRequest,
    normalizeCraftRequestType,
    insertRequest,
    updateRequestCraft,
    updateRequestSale,
    markRequestPosted,
    getWeaponSaleStateForCraftRequest,
    getLinkedMyWeaponsForRequest,
    serialAlreadyListed,
    getMyWeaponById,
    deleteRequest,
    deleteCraftRequestCleanly,
} = createCraftRequestService({
    getDb: () => db,
    productionStatuses: CRAFT_PRODUCTION_STATUSES,
    getWeapon: (...args) => getWeapon(...args),
    consumeStockForCraftRequest: (...args) => consumeStockForCraftRequest(...args),
    restoreStockForCraftRequest: (...args) => restoreStockForCraftRequest(...args),
    invalidateCraftCaches: () => invalidateCraftCaches(),
}));

function registerCraftEndpoints(app, requireAuth, requireAdmin, botClient, botState) {
    const express = require('express');
    function canAccessCraftImages(user) {
        if (canValidateCraft(user)) return true;
        const roles = user?.roles || [];
        return LIMITED_CRAFT_ACCESS_ROLES.some(roleId => roles.includes(roleId));
    }

    app.use('/crafts/images', requireAuth, (req, res, next) => {
        if (!canAccessCraftImages(req.session.user)) {
            return res.status(403).json({ error: 'Accès craft requis' });
        }
        next();
    }, express.static(UPLOADS_DIR));

    const memberPresenceCache = new Map();
    let lastMissingMemberSweep = 0;
    const MEMBER_CACHE_TTL_MS = 15 * 60 * 1000;
    const MEMBER_SWEEP_TTL_MS = 5 * 60 * 1000;
    const MEMBER_SWEEP_LIMIT = 25;
    const ABSENT_MEMBER_CHECK_STATUSES = ['pending', 'materials', 'waiting_materials', 'in_progress'];
    const moneyLabel = (amount) => Number(amount) === 0 ? 'Gratuit' : (amount ? `${Number(amount).toLocaleString('fr-FR')}$` : 'N/A');

    function canValidateCraft(user) {
        if (!user) return false;
        if (user.id === ADMIN_USER_ID) return true;
        const userRoles = user.roles || [];
        return CRAFT_VALIDATION_ROLES.some(r => userRoles.includes(r));
    }

    function canDeleteRequests(user) {
        if (!user) return false;
        if (user.id === ADMIN_USER_ID) return true;
        return (user.roles || []).includes(ADMIN_ROLE_ID);
    }

    function canDeleteMyWeapons(user) {
        if (!user) return false;
        if (user.id === ADMIN_USER_ID) return true;
        const roles = user.roles || [];
        return roles.includes(MY_WEAPONS_DELETE_ROLE) || canDeleteRequests(user);
    }

    function isCraftManager(user) {
        return canValidateCraft(user) || canDeleteRequests(user);
    }

    async function guildHasMember(userId) {
        const cleanUserId = String(userId || '').trim();
        if (!cleanUserId || !botClient?.guilds) return true;
        const cached = memberPresenceCache.get(cleanUserId);
        if (cached && Date.now() - cached.checkedAt < MEMBER_CACHE_TTL_MS) return cached.exists;

        const guildId = config.discord?.guildId || process.env.GUILD_ID || botState?.()?.CONFIG?.GUILD_ID;
        const guild = guildId
            ? (botClient.guilds.cache.get(guildId) || await botClient.guilds.fetch(guildId).catch(() => null))
            : botClient.guilds.cache.first();
        if (!guild?.members) return true;

        const exists = !!(await guild.members.fetch(cleanUserId).catch(() => null));
        memberPresenceCache.set(cleanUserId, { exists, checkedAt: Date.now() });
        return exists;
    }

    async function getDiscordUserAvatar(userId) {
        const cleanUserId = String(userId || '').trim();
        if (!cleanUserId || !botClient?.guilds) return null;

        try {
            const guildId = config.discord?.guildId || process.env.GUILD_ID || botState?.()?.CONFIG?.GUILD_ID;
            const guild = guildId
                ? (botClient.guilds.cache.get(guildId) || await botClient.guilds.fetch(guildId).catch(() => null))
                : botClient.guilds.cache.first();
            if (!guild?.members) return null;

            const fetchMember = guild.members.fetch(cleanUserId).catch(() => null);
            const timeout = new Promise(resolve => setTimeout(() => resolve(null), 2500));
            const member = await Promise.race([fetchMember, timeout]);
            return member?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;
        } catch (e) {
            console.warn(`[discord] avatar introuvable pour ${cleanUserId}: ${e.message}`);
            return null;
        }
    }

    function markRequestsRejectedForAbsentMember(userId) {
        const now = Math.floor(Date.now() / 1000);
        const reason = 'Membre plus présent sur le Discord';
        db.prepare(`UPDATE craft_requests SET status = 'rejected', refusal_reason = ? WHERE user_id = ? AND status IN (${ABSENT_MEMBER_CHECK_STATUSES.map(() => '?').join(',')})`)
            .run(reason, userId, ...ABSENT_MEMBER_CHECK_STATUSES);
        invalidateCraftCaches();
    }

    async function sweepRequestsForMissingMembers() {
        if (!botClient?.isReady?.() || Date.now() - lastMissingMemberSweep < MEMBER_SWEEP_TTL_MS) return;
        lastMissingMemberSweep = Date.now();
        const activeRequests = getRequests('all')
            .filter(r => ABSENT_MEMBER_CHECK_STATUSES.includes(r.status))
            .filter(r => r.user_id)
            .slice(0, 250);
        const uniqueUserIds = [...new Set(activeRequests.map(r => String(r.user_id)))].slice(0, MEMBER_SWEEP_LIMIT);
        for (const userId of uniqueUserIds) {
            const exists = await guildHasMember(userId);
            if (!exists) {
                console.warn(`[craft] demandes refusées automatiquement: membre absent ${userId}`);
                markRequestsRejectedForAbsentMember(userId);
            }
        }
    }

    registerCraftCatalogRoutes(app, {
        fs,
        path,
        upload,
        uploadsDir: UPLOADS_DIR,
        requireAuth,
        requireAdmin,
        canValidateCraft,
        getCraftableWeapons,
        updateStockMaterial,
        getAllWeapons,
        getAllIngredients,
        getWeapon,
        insertWeapon,
        updateWeapon,
        deleteWeapon,
        getIngredient,
        insertIngredient,
        updateIngredient,
        deleteIngredient,
        getAllMyWeaponNamesWithPriceLimits,
        insertMyWeaponName,
        updateMyWeaponName,
        deleteMyWeaponName,
        getAllOrgs,
        insertOrg,
        deleteOrg,
    });

    registerOrderAdvanceRoutes(app, {
        requireAdmin,
        getOrderAdvances,
        upsertOrderAdvance,
        deleteOrderAdvance,
        settleOrderAdvance,
        saveOrderAdvanceRepayment,
        deleteOrderAdvanceRepayment,
    });

    registerCraftRequestRoutes(app, {
        requireAuth,
        botClient,
        botState,
        db,
        isCraftManager,
        sweepRequestsForMissingMembers,
        getRequests,
        getWeaponSaleStateForCraftRequest,
        getRequest,
        normalizeCraftRequestType,
        getWeapon,
        insertRequest,
        updateRequestCraft,
        invalidateCraftCaches,
        deleteCraftRequestCleanly,
        deleteRequest,
        markRequestPosted,
    });

    registerMyWeaponsRoutes(app, {
        requireAuth,
        botClient,
        botState,
        db,
        canValidateCraft,
        canDeleteRequests,
        canDeleteMyWeapons,
        getDiscordUserAvatar,
        getWeapon,
        getWeaponByName,
        getMyWeaponNameByName,
        getAllMyWeaponNames,
        getRequest,
        getWeaponSaleStateForCraftRequest,
        serialAlreadyListed,
        markRequestPosted,
        emitRealtime,
        moneyLabel,
    });

}

module.exports = { initDB, registerCraftEndpoints };
