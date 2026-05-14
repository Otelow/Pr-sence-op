// ==========================================
// MODULE CRAFTS — DB SQLite
// MODIFIÉ CHANTIER 3 — 14/05/2026 — images craft protégées par session
// MODIFIÉ CHANTIER 4 — 14/05/2026 — rôles craft centralisés
// MODIFIÉ CHANTIER 5 — 14/05/2026 — suppression du fallback JSON
// MODIFIÉ CHANTIER 12 — 14/05/2026 — events temps réel craft/dashboard
// ==========================================
const path = require('path');
const fs = require('fs');
const multer = require('multer');
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

const DATA_DIR = config.paths.data;
const DB_PATH = config.paths.database;
const UPLOADS_DIR = config.paths.craftsUploads;
const Database = require('better-sqlite3');
let db = null;

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
const CRAFTABLE_CACHE_TTL_MS = 10_000;

let craftableWeaponsCache = null;
let craftableWeaponsCacheExpiresAt = 0;

function invalidateCraftCaches() {
    craftableWeaponsCache = null;
    craftableWeaponsCacheExpiresAt = 0;
}

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

function getAllWeapons() {
    return db.prepare('SELECT * FROM weapons ORDER BY name ASC').all();}

function getWeapon(id) {
    return db.prepare('SELECT * FROM weapons WHERE id = ?').get(id);}

function getWeaponByName(name) {
    const clean = String(name || '').trim().toLowerCase();
    if (!clean) return null;
    return db.prepare('SELECT * FROM weapons WHERE LOWER(name) = ? LIMIT 1').get(clean) || null;}

function insertWeapon(name, image_path, plan_image_path, requires_plan, craft_time, craft_price, sale_price, max_sale_price, ingredients) {
            const r = db.prepare(`INSERT INTO weapons (name, image_path, plan_image_path, requires_plan, craft_time, craft_price, sale_price, max_sale_price, ingredients) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(name, image_path, plan_image_path, requires_plan ? 1 : 0, craft_time, craft_price, sale_price, max_sale_price, ingredients);
        invalidateCraftCaches();
        return r.lastInsertRowid;
}

function updateWeapon(id, name, image_path, plan_image_path, requires_plan, craft_time, craft_price, sale_price, max_sale_price, ingredients) {
            db.prepare(`UPDATE weapons SET name = ?, craft_time = ?, craft_price = ?, sale_price = ?, max_sale_price = ?, ingredients = ?, requires_plan = ?, image_path = COALESCE(?, image_path), plan_image_path = COALESCE(?, plan_image_path) WHERE id = ?`)
            .run(name, craft_time, craft_price, sale_price, max_sale_price, ingredients, requires_plan ? 1 : 0, image_path, plan_image_path, id);
        invalidateCraftCaches();
        return;
}

function deleteWeapon(id) {
     db.prepare('DELETE FROM weapons WHERE id = ?').run(id); invalidateCraftCaches(); return;
}

// ─── INGREDIENTS ───────────────
function getAllIngredients() {
    return db.prepare('SELECT * FROM ingredients ORDER BY name ASC').all();}

function getIngredient(id) {
    return db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);}

function insertIngredient(name, image_path) {
            const r = db.prepare('INSERT OR IGNORE INTO ingredients (name, image_path) VALUES (?, ?)').run(name, image_path);
        if (isStockMaterialName(name)) seedStockMaterials();
        else invalidateCraftCaches();
        return r.lastInsertRowid;
}

function updateIngredient(id, name, image_path) {
            db.prepare(`UPDATE ingredients SET name = ?, image_path = COALESCE(?, image_path) WHERE id = ?`).run(name, image_path, id);
        if (isStockMaterialName(name)) seedStockMaterials();
        else invalidateCraftCaches();
        return;
}

function deleteIngredient(id) {
    const existing = getIngredient(id);
            db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
        if (existing && isStockMaterialName(existing.name)) seedStockMaterials();
        else invalidateCraftCaches();
        return;
}

function toCraftImageUrl(imagePath) {
    const value = String(imagePath || '').trim();
    if (!value) return null;
    if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value;
    return `/crafts/images/${value}`;
}

function dedupeStockRows(rows, ingredients = []) {
    const imageByName = new Map();
    for (const ingredient of ingredients) {
        const canonicalName = getCanonicalStockMaterialName(ingredient.name);
        if (!canonicalName || !ingredient.image_path) continue;
        if (!imageByName.has(canonicalName)) imageByName.set(canonicalName, ingredient.image_path);
    }

    const byName = new Map();
    for (const row of rows) {
        const canonicalName = getCanonicalStockMaterialName(row.name);
        if (!canonicalName) continue;
        const imagePath = row.image_path || imageByName.get(canonicalName) || null;
        const existing = byName.get(canonicalName);
        const cleanRow = {
            ...row,
            name: canonicalName,
            quantity: Number(row.quantity) || 0,
            image_path: imagePath,
            image_url: toCraftImageUrl(imagePath),
        };
        if (!existing) {
            byName.set(canonicalName, cleanRow);
            continue;
        }
        byName.set(canonicalName, {
            ...existing,
            ingredient_id: existing.image_path ? existing.ingredient_id : cleanRow.ingredient_id,
            image_path: existing.image_path || cleanRow.image_path,
            image_url: existing.image_url || cleanRow.image_url,
            quantity: Math.max(Number(existing.quantity) || 0, cleanRow.quantity),
            updated_at: Math.max(Number(existing.updated_at) || 0, Number(cleanRow.updated_at) || 0),
        });
    }
    return STOCK_MATERIAL_NAMES
        .map(name => byName.get(name))
        .filter(Boolean);
}

function getStockMaterials() {
            const ingredients = db.prepare('SELECT * FROM ingredients').all();
        const rows = db.prepare(`
            SELECT sm.id, sm.ingredient_id, sm.quantity, sm.updated_at, i.name, i.image_path
            FROM stock_materials sm
            JOIN ingredients i ON i.id = sm.ingredient_id
            ORDER BY i.name ASC
        `).all();
        return dedupeStockRows(rows, ingredients);
}

function getReservedStockByActiveRequests() {
    const reservedByIngredientId = new Map();
    const reservedByName = new Map();
    const weapons = getAllWeapons();
    const weaponsById = new Map(weapons.map(weapon => [Number(weapon.id), weapon]));
    const ingredients = getAllIngredients();
    const ingredientById = new Map(ingredients.map(item => [Number(item.id), item]));
    const ingredientByName = new Map(ingredients.map(item => [normalizeStockName(item.name), item]));
    const activeRequests = getRequests('all', { productionOnly: true });

    for (const request of activeRequests) {
        if (request.is_test) continue;
        if (request.stock_consumed_at) continue;
        if (!CRAFT_STOCK_RESERVED_STATUSES.includes(request.status)) continue;
        const weapon = weaponsById.get(Number(request.weapon_id));
        if (!weapon) continue;

        for (const recipe of parseWeaponIngredients(weapon.ingredients)) {
            const ingredientId = Number(recipe.ingredient_id || recipe.id || 0);
            const ingredient = ingredientById.get(ingredientId)
                || ingredientByName.get(normalizeStockName(recipe.name))
                || null;
            const name = ingredient?.name || recipe.name || '';
            if (!isStockMaterialName(name)) continue;

            const required = Math.max(0, parseInt(recipe.quantity || recipe.qty || recipe.amount, 10) || 0);
            if (!required) continue;

            if (ingredient) {
                const id = Number(ingredient.id);
                reservedByIngredientId.set(id, (reservedByIngredientId.get(id) || 0) + required);
            }
            const normalizedName = normalizeStockName(name);
            reservedByName.set(normalizedName, (reservedByName.get(normalizedName) || 0) + required);
        }
    }

    return { byIngredientId: reservedByIngredientId, byName: reservedByName };
}

function createStockError(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

function getStockRequirementsForWeapon(weapon) {
    if (!weapon) throw createStockError('Arme introuvable pour le calcul du stock');

    const ingredients = getAllIngredients();
    const ingredientById = new Map(ingredients.map(item => [Number(item.id), item]));
    const ingredientByName = new Map(ingredients.map(item => [normalizeStockName(item.name), item]));
    const stockMaterials = getStockMaterials();
    const stockByIngredientId = new Map(stockMaterials.map(item => [Number(item.ingredient_id), item]));
    const stockByName = new Map(stockMaterials.map(item => [normalizeStockName(item.name), item]));
    const requirementsByIngredient = new Map();

    for (const recipe of parseWeaponIngredients(weapon.ingredients)) {
        const recipeIngredientId = Number(recipe.ingredient_id || recipe.id || 0);
        const ingredient = ingredientById.get(recipeIngredientId)
            || ingredientByName.get(normalizeStockName(recipe.name))
            || null;
        const name = ingredient?.name || recipe.name || '';
        if (!isStockMaterialName(name)) continue;

        const required = Math.max(0, parseInt(recipe.quantity || recipe.qty || recipe.amount, 10) || 0);
        if (!required) continue;

        const stock = (ingredient ? stockByIngredientId.get(Number(ingredient.id)) : null)
            || stockByName.get(normalizeStockName(name));
        if (!stock) throw createStockError(`Stock introuvable pour ${getCanonicalStockMaterialName(name) || name}`);

        const stockIngredientId = Number(stock.ingredient_id);
        const existing = requirementsByIngredient.get(stockIngredientId);
        if (existing) {
            existing.quantity += required;
        } else {
            requirementsByIngredient.set(stockIngredientId, {
                ingredient_id: stockIngredientId,
                name: stock.name,
                quantity: required,
            });
        }
    }

    return [...requirementsByIngredient.values()];
}

function applyStockDelta(requirements, delta, now) {
    if (!requirements.length) return;

    const selectStock = db.prepare('SELECT quantity FROM stock_materials WHERE ingredient_id = ?');
    const updateStock = db.prepare('UPDATE stock_materials SET quantity = ?, updated_at = ? WHERE ingredient_id = ?');

    if (delta < 0) {
        for (const requirement of requirements) {
            const current = selectStock.get(requirement.ingredient_id);
            const currentQuantity = Number(current?.quantity) || 0;
            if (currentQuantity < requirement.quantity) {
                throw createStockError(`Stock insuffisant pour ${requirement.name} (${currentQuantity}/${requirement.quantity})`);
            }
        }
    }

    for (const requirement of requirements) {
        const current = selectStock.get(requirement.ingredient_id);
        const currentQuantity = Number(current?.quantity) || 0;
        const nextQuantity = currentQuantity + delta * requirement.quantity;
        updateStock.run(nextQuantity, now, requirement.ingredient_id);
    }
    invalidateCraftCaches();
}

function consumeStockForCraftRequest(request, now) {
    const weapon = getWeapon(request.weapon_id);
    const requirements = getStockRequirementsForWeapon(weapon);
    applyStockDelta(requirements, -1, now);

            db.prepare('UPDATE craft_requests SET stock_consumed_at = ? WHERE id = ?').run(now, request.id);

}

function restoreStockForCraftRequest(request, now) {
    const weapon = getWeapon(request.weapon_id);
    const requirements = getStockRequirementsForWeapon(weapon);
    applyStockDelta(requirements, 1, now);

            db.prepare('UPDATE craft_requests SET stock_consumed_at = NULL WHERE id = ?').run(request.id);

}

function getAvailableStock() {
    const stockMaterials = getStockMaterials();
    const reserved = getReservedStockByActiveRequests();

    return stockMaterials.map(material => {
        const total = Number(material.quantity) || 0;
        const reservedById = reserved.byIngredientId.get(Number(material.ingredient_id));
        const reservedByName = reserved.byName.get(normalizeStockName(material.name));
        const quantityReserved = Math.max(0, Number(reservedById ?? reservedByName) || 0);
        const quantityAvailable = Math.max(0, total - quantityReserved);

        return {
            ...material,
            quantity_total: total,
            quantity_reserved: quantityReserved,
            quantity_available: quantityAvailable,
        };
    });
}

function updateStockMaterial(ingredientId, quantity) {
    const cleanIngredientId = Number(ingredientId);
    const cleanQuantity = Math.max(0, parseInt(quantity, 10) || 0);
    const ingredient = getIngredient(cleanIngredientId);
    if (!ingredient || !isStockMaterialName(ingredient.name)) {
        throw new Error('Matiere premiere introuvable');
    }

            db.prepare(`
            INSERT INTO stock_materials (ingredient_id, quantity, updated_at)
            VALUES (?, ?, strftime('%s','now'))
            ON CONFLICT(ingredient_id) DO UPDATE SET
                quantity = excluded.quantity,
                updated_at = excluded.updated_at
        `).run(cleanIngredientId, cleanQuantity);
        invalidateCraftCaches();
        return getStockMaterials();
}

function getCraftableWeapons(options = {}) {
    const useCache = options.useCache !== false;
    const nowMs = Date.now();
    if (useCache && craftableWeaponsCache && craftableWeaponsCacheExpiresAt > nowMs) {
        return craftableWeaponsCache;
    }

    const weapons = getAllWeapons();
    const ingredients = getAllIngredients();
    const ingredientById = new Map(ingredients.map(item => [Number(item.id), item]));
    const ingredientByName = new Map(ingredients.map(item => [normalizeStockName(item.name), item]));
    const stockMaterials = getAvailableStock();
    const stockByIngredientId = new Map(stockMaterials.map(item => [Number(item.ingredient_id), item]));
    const stockByName = new Map(stockMaterials.map(item => [normalizeStockName(item.name), item]));

    const decoratedWeapons = weapons.map(weapon => {
        const requiredMaterials = parseWeaponIngredients(weapon.ingredients).map(recipe => {
            const ingredientId = Number(recipe.ingredient_id || recipe.id || 0);
            const ingredient = ingredientById.get(ingredientId)
                || ingredientByName.get(normalizeStockName(recipe.name))
                || null;
            const name = ingredient?.name || recipe.name || 'Ingredient';
            const required = Math.max(0, parseInt(recipe.quantity || recipe.qty || recipe.amount, 10) || 0);
            const stock = (ingredient ? stockByIngredientId.get(Number(ingredient.id)) : null)
                || stockByName.get(normalizeStockName(name))
                || null;
            const tracked = Boolean(stock || isStockMaterialName(name));
            const available = stock ? Number(stock.quantity_available ?? stock.quantity) || 0 : 0;

            return {
                ingredient_id: ingredient ? ingredient.id : ingredientId || null,
                name,
                required,
                available: tracked ? available : null,
                available_total: tracked && stock ? Number(stock.quantity_total ?? stock.quantity) || 0 : null,
                reserved: tracked && stock ? Number(stock.quantity_reserved) || 0 : 0,
                tracked,
                sufficient: !tracked || available >= required,
                image_url: toCraftImageUrl(ingredient?.image_path),
            };
        });

        const trackedMaterials = requiredMaterials.filter(item => item.tracked);
        const craftableCounts = trackedMaterials
            .filter(item => Number(item.required) > 0)
            .map(item => Math.floor((Number(item.available) || 0) / Number(item.required)));
        const maxCraftable = craftableCounts.length ? Math.max(0, Math.min(...craftableCounts)) : 0;
        const craftable = maxCraftable > 0;
        return {
            ...weapon,
            ingredients: requiredMaterials,
            image_url: toCraftImageUrl(weapon.image_path),
            plan_image_url: toCraftImageUrl(weapon.plan_image_path),
            requires_plan: Boolean(weapon.requires_plan),
            craftable,
            maxCraftable,
            stock_status: craftable ? 'ok' : 'missing',
        };
    });

    decoratedWeapons.sort((a, b) => {
        if (Number(b.craftable) !== Number(a.craftable)) return Number(b.craftable) - Number(a.craftable);
        const saleDiff = (Number(b.sale_price) || 0) - (Number(a.sale_price) || 0);
        if (saleDiff !== 0) return saleDiff;
        return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    });

    const result = {
        stocks: stockMaterials,
        weapons: decoratedWeapons,
    };
    craftableWeaponsCache = result;
    craftableWeaponsCacheExpiresAt = nowMs + CRAFTABLE_CACHE_TTL_MS;
    return result;
}

function getAllMyWeaponNames() {
    return db.prepare('SELECT * FROM my_weapon_names ORDER BY name ASC').all();}

function getMyWeaponNameByName(name) {
    const clean = String(name || '').trim().toLowerCase();
    if (!clean) return null;
    return db.prepare('SELECT * FROM my_weapon_names WHERE LOWER(name) = ? LIMIT 1').get(clean) || null;}

function getAllMyWeaponNamesWithPriceLimits() {
    return getAllMyWeaponNames().map(item => {
        const adminWeapon = getWeaponByName(item.name);
        const weaponSalePrice = Number(adminWeapon?.sale_price) || 0;
        const weaponMaxSalePrice = Number(adminWeapon?.max_sale_price) || 0;
        return {
            ...item,
            max_sale_price: weaponMaxSalePrice > 0 ? weaponMaxSalePrice : (Number(item.max_sale_price) || 0),
            sale_price: weaponSalePrice > 0 ? weaponSalePrice : (Number(item.sale_price) || 0),
            price_source: adminWeapon ? 'craft_catalog' : 'my_weapon_names',
        };
    });
}

function insertMyWeaponName(name, sale_price = 0, max_sale_price = 0) {
    const clean = String(name || '').trim();
    if (!clean) return null;
    const salePrice = Math.max(0, parseInt(sale_price, 10) || 0);
    const maxSalePrice = Math.max(0, parseInt(max_sale_price, 10) || 0);
            const r = db.prepare('INSERT OR IGNORE INTO my_weapon_names (name, sale_price, max_sale_price) VALUES (?, ?, ?)').run(clean, salePrice, maxSalePrice);
        if (!r.changes) {
            db.prepare('UPDATE my_weapon_names SET sale_price = ?, max_sale_price = ? WHERE LOWER(name) = ?').run(salePrice, maxSalePrice, clean.toLowerCase());
        }
        return r.lastInsertRowid;
}

function updateMyWeaponName(id, name, sale_price = 0, max_sale_price = 0) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Nom requis');
    const salePrice = Math.max(0, parseInt(sale_price, 10) || 0);
    const maxSalePrice = Math.max(0, parseInt(max_sale_price, 10) || 0);
            db.prepare('UPDATE my_weapon_names SET name = ?, sale_price = ?, max_sale_price = ? WHERE id = ?').run(clean, salePrice, maxSalePrice, id);
        return;
}

function deleteMyWeaponName(id) {
    db.prepare('DELETE FROM my_weapon_names WHERE id = ?').run(id); return;
}

function getAllOrgs() {
    return db.prepare('SELECT * FROM organizations ORDER BY name ASC').all();}

function insertOrg(name) {
    const r = db.prepare('INSERT OR IGNORE INTO organizations (name) VALUES (?)').run(name);
    return r.lastInsertRowid || null;
}

function deleteOrg(id) {
    db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
}

function cleanMoney(value) {
    const parsed = parseInt(String(value ?? '').replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function orderAdvanceTitle(orderDate) {
    return `Commande matières premières du ${orderDate || todayIsoDate()}`;
}

function normalizeAdvanceParticipants(participants = []) {
    const seenParticipants = new Set();
    const normalized = [];
    for (const p of (Array.isArray(participants) ? participants : []).slice(0, 3)) {
        const userName = String(p.user_name || p.name || '').trim();
        if (!userName) continue;
        const userId = String(p.user_id || '').trim() || null;
        const uniqueKey = (userId || userName).toLowerCase();
        if (seenParticipants.has(uniqueKey)) {
            throw new Error('Chaque participant ne peut être choisi qu’une seule fois');
        }
        seenParticipants.add(uniqueKey);
        const amountContributed = cleanMoney(p.amount_contributed);
        const amountRecovered = cleanMoney(p.amount_recovered);
        normalized.push({
            user_id: userId,
            user_name: userName,
            amount_contributed: amountContributed,
            amount_recovered: amountRecovered,
            amount_remaining: Math.max(0, amountContributed - amountRecovered),
            amount_to_compensate_next_order: cleanMoney(p.amount_to_compensate_next_order),
            note: String(p.note || '').trim() || null,
        });
    }
    return normalized;
}

function calculateAdvanceTotals(payload, participants, legacyRecoveredAmount = 0) {
    const contributedTotal = participants.reduce((sum, p) => sum + p.amount_contributed, 0);
    const totalAmount = cleanMoney(payload.total_amount) || contributedTotal;
    const recoveredFromPayload = Object.prototype.hasOwnProperty.call(payload, 'recovered_amount')
        ? cleanMoney(payload.recovered_amount)
        : cleanMoney(legacyRecoveredAmount);
    const recoveredFromParticipants = participants.reduce((sum, p) => sum + p.amount_recovered, 0);
    const recoveredAmount = recoveredFromPayload || recoveredFromParticipants;
    return {
        total_amount: totalAmount,
        recovered_amount: recoveredAmount,
        remaining_amount: Math.max(0, totalAmount - recoveredAmount),
    };
}

function hydrateOrderAdvance(order, participants = [], repayments = []) {
    const totalAmount = cleanMoney(order.total_amount);
    const legacyRecoveredAmount = cleanMoney(order.recovered_amount);
    const detailedRepayments = Array.isArray(repayments) ? repayments : [];
    const hasDetailedRepayments = detailedRepayments.length > 0;
    const repaymentByParticipant = new Map();
    const repaymentByUser = new Map();

    for (const repayment of detailedRepayments) {
        const amount = cleanMoney(repayment.amount);
        if (repayment.participant_id) {
            const key = String(repayment.participant_id);
            repaymentByParticipant.set(key, (repaymentByParticipant.get(key) || 0) + amount);
        }
        if (repayment.user_id) {
            const key = String(repayment.user_id);
            repaymentByUser.set(key, (repaymentByUser.get(key) || 0) + amount);
        }
    }

    const hydratedParticipants = participants.map(participant => {
        let recovered = cleanMoney(participant.amount_recovered);
        if (hasDetailedRepayments) {
            recovered = repaymentByParticipant.get(String(participant.id)) || repaymentByUser.get(String(participant.user_id)) || 0;
        } else if (participants.length === 1 && legacyRecoveredAmount > recovered) {
            recovered = legacyRecoveredAmount;
        }
        const contributed = cleanMoney(participant.amount_contributed);
        return {
            ...participant,
            amount_contributed: contributed,
            amount_recovered: recovered,
            amount_remaining: Math.max(0, contributed - recovered),
        };
    });

    let recoveredAmount = hasDetailedRepayments
        ? detailedRepayments.reduce((sum, repayment) => sum + cleanMoney(repayment.amount), 0)
        : (legacyRecoveredAmount || hydratedParticipants.reduce((sum, participant) => sum + cleanMoney(participant.amount_recovered), 0));
    let remainingAmount = Math.max(0, totalAmount - recoveredAmount);

    if (order.status === 'settled') {
        recoveredAmount = totalAmount;
        remainingAmount = 0;
        for (const participant of hydratedParticipants) {
            participant.amount_recovered = participant.amount_contributed;
            participant.amount_remaining = 0;
        }
    }

    return {
        ...order,
        title: order.title || orderAdvanceTitle(order.order_date),
        total_amount: totalAmount,
        recovered_amount: recoveredAmount,
        legacy_recovered_amount: legacyRecoveredAmount,
        remaining_amount: remainingAmount,
        status: order.status === 'settled' || remainingAmount <= 0 ? 'settled' : (recoveredAmount > 0 ? 'partial' : 'open'),
        has_detailed_repayments: hasDetailedRepayments,
        participants: hydratedParticipants,
        repayments: detailedRepayments,
    };
}

function getOrderAdvances() {
            const orders = db.prepare('SELECT * FROM order_advances ORDER BY status ASC, order_date DESC, id DESC').all();
        const getParticipants = db.prepare('SELECT * FROM order_advance_participants WHERE order_id = ? ORDER BY id ASC');
        const getRepayments = db.prepare('SELECT * FROM order_advance_repayments WHERE order_id = ? ORDER BY repayment_date DESC, id DESC');
        return orders.map(order => hydrateOrderAdvance(order, getParticipants.all(order.id), getRepayments.all(order.id)));
}

function upsertOrderAdvance(payload, id = null) {
    const orderIdForUpdate = Number(id);
    let existingOrder = null;
    if (orderIdForUpdate) {
        existingOrder = db.prepare('SELECT * FROM order_advances WHERE id = ?').get(orderIdForUpdate);
        if (!existingOrder) throw new Error('Commande introuvable');
    }
    const participants = normalizeAdvanceParticipants(payload.participants);
    if (!participants.length) throw new Error('Ajoute au moins un participant');
    const now = Math.floor(Date.now() / 1000);
    const orderDate = String(payload.order_date || '').trim() || null;
    if (!orderDate) throw new Error('Date de commande requise');
    const title = String(payload.title || existingOrder?.title || orderAdvanceTitle(orderDate)).trim();
    const legacyRecovered = existingOrder && !Object.prototype.hasOwnProperty.call(payload, 'recovered_amount')
        ? existingOrder.recovered_amount
        : payload.recovered_amount;
    const totals = calculateAdvanceTotals(payload, participants, legacyRecovered);
    const note = Object.prototype.hasOwnProperty.call(payload, 'note')
        ? (String(payload.note || '').trim() || null)
        : (existingOrder?.note || null);
    const requestedStatus = String(payload.status || 'open').trim();
    const status = requestedStatus === 'settled' ? 'settled' : (totals.remaining_amount <= 0 ? 'settled' : 'open');

    const tx = db.transaction(() => {
        let orderId = orderIdForUpdate;
        if (orderId) {
            db.prepare(`UPDATE order_advances SET title = ?, order_date = ?, total_amount = ?, recovered_amount = ?, remaining_amount = ?, note = ?, status = ?, updated_at = ? WHERE id = ?`)
                .run(title, orderDate, totals.total_amount, totals.recovered_amount, totals.remaining_amount, note, status, now, orderId);
            db.prepare('DELETE FROM order_advance_participants WHERE order_id = ?').run(orderId);
        } else {
            const r = db.prepare(`INSERT INTO order_advances (title, order_date, total_amount, recovered_amount, remaining_amount, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(title, orderDate, totals.total_amount, totals.recovered_amount, totals.remaining_amount, note, status, now, now);
            orderId = r.lastInsertRowid;
        }
        const stmt = db.prepare(`INSERT INTO order_advance_participants (order_id, user_id, user_name, amount_contributed, amount_recovered, amount_remaining, amount_to_compensate_next_order, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const p of participants) {
            stmt.run(orderId, p.user_id, p.user_name, p.amount_contributed, p.amount_recovered, p.amount_remaining, p.amount_to_compensate_next_order, p.note, now, now);
        }
        return orderId;
    });
    return tx();
}

function deleteOrderAdvance(id) {
            db.prepare('DELETE FROM order_advance_repayments WHERE order_id = ?').run(id);
        db.prepare('DELETE FROM order_advance_participants WHERE order_id = ?').run(id);
        db.prepare('DELETE FROM order_advances WHERE id = ?').run(id);
        return;
}

function settleOrderAdvance(id) {
    const now = Math.floor(Date.now() / 1000);
            const order = db.prepare('SELECT * FROM order_advances WHERE id = ?').get(id);
        if (!order) throw new Error('Commande introuvable');
        db.prepare(`UPDATE order_advances SET recovered_amount = total_amount, remaining_amount = 0, status = 'settled', updated_at = ? WHERE id = ?`).run(now, id);
        db.prepare(`UPDATE order_advance_participants SET amount_recovered = amount_contributed, amount_remaining = 0, updated_at = ? WHERE order_id = ?`).run(now, id);
        return;
}

function normalizeOrderAdvanceRepayment(orderId, payload) {
    const participantId = parseInt(payload.participant_id, 10);
    const amount = cleanMoney(payload.amount);
    const repaymentDate = String(payload.repayment_date || todayIsoDate()).trim();
    if (!orderId) throw new Error('Commande introuvable');
    if (!participantId) throw new Error('Participant obligatoire');
    if (!amount) throw new Error('Montant récupéré obligatoire');
    if (!repaymentDate) throw new Error('Date de remboursement obligatoire');

    let participant;
            participant = db.prepare('SELECT * FROM order_advance_participants WHERE id = ? AND order_id = ?').get(participantId, orderId);

    if (!participant) throw new Error('Participant introuvable pour cette commande');

    return {
        order_id: orderId,
        participant_id: participantId,
        user_id: participant.user_id || null,
        user_name: participant.user_name,
        amount,
        reason: String(payload.reason || '').trim() || null,
        weapon_name: String(payload.weapon_name || '').trim() || null,
        repayment_date: repaymentDate,
    };
}

function saveOrderAdvanceRepayment(orderId, payload, repaymentId = null) {
    const normalized = normalizeOrderAdvanceRepayment(orderId, payload);
    const now = Math.floor(Date.now() / 1000);
            if (repaymentId) {
            const existing = db.prepare('SELECT * FROM order_advance_repayments WHERE id = ? AND order_id = ?').get(repaymentId, orderId);
            if (!existing) throw new Error('Remboursement introuvable');
            db.prepare(`UPDATE order_advance_repayments SET participant_id = ?, user_id = ?, user_name = ?, amount = ?, reason = ?, weapon_name = ?, repayment_date = ?, updated_at = ? WHERE id = ? AND order_id = ?`)
                .run(normalized.participant_id, normalized.user_id, normalized.user_name, normalized.amount, normalized.reason, normalized.weapon_name, normalized.repayment_date, now, repaymentId, orderId);
            return repaymentId;
        }
        const result = db.prepare(`INSERT INTO order_advance_repayments (order_id, participant_id, user_id, user_name, amount, reason, weapon_name, repayment_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(orderId, normalized.participant_id, normalized.user_id, normalized.user_name, normalized.amount, normalized.reason, normalized.weapon_name, normalized.repayment_date, now, now);
        return result.lastInsertRowid;
}

function deleteOrderAdvanceRepayment(orderId, repaymentId) {
            const result = db.prepare('DELETE FROM order_advance_repayments WHERE id = ? AND order_id = ?').run(repaymentId, orderId);
        if (!result.changes) throw new Error('Remboursement introuvable');
        return;
}

function getRequests(status, options = {}) {
    let query = `SELECT r.*, w.name as weapon_name, w.image_path as weapon_image, w.craft_price as weapon_craft_price FROM craft_requests r JOIN weapons w ON r.weapon_id = w.id`;
    const params = [];
    const where = [];
    if (options.productionOnly) {
        where.push(`r.status IN (${CRAFT_PRODUCTION_STATUSES.map(() => '?').join(',')})`);
        params.push(...CRAFT_PRODUCTION_STATUSES);
    } else if (status && status !== 'all') {
        where.push('r.status = ?');
        params.push(status);
    }
    if (options.hideTests) {
        where.push('COALESCE(r.is_test, 0) = 0');
    }
    if (where.length) query += ` WHERE ${where.join(' AND ')}`;
    query += ' ORDER BY r.created_at DESC';
    return db.prepare(query).all(...params);
}

function getRequest(id) {
    return db.prepare(`SELECT r.*, w.name as weapon_name, w.image_path as weapon_image FROM craft_requests r JOIN weapons w ON r.weapon_id = w.id WHERE r.id = ?`).get(id);
}

function normalizeCraftRequestType(value) {
    const clean = String(value || '').trim();
    return ['sale', 'personal'].includes(clean) ? clean : null;
}

function insertRequest(user_id, user_name, weapon_id, has_plan, has_money, request_type, is_test = false) {
    const normalizedType = normalizeCraftRequestType(request_type);
            const r = db.prepare(`INSERT INTO craft_requests (user_id, user_name, weapon_id, has_plan, has_money, request_type, is_test) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(user_id, user_name, weapon_id, has_plan ? 1 : 0, has_money ? 1 : 0, normalizedType, is_test ? 1 : 0);
        return r.lastInsertRowid;
}

function updateRequestCraft(id, crafted, serial, userId, userName) {
    const now = Math.floor(Date.now() / 1000);
    const tx = db.transaction(() => {
        const current = getRequest(id);
        if (!current) throw createStockError('Demande introuvable');

        if (!current.is_test && crafted && !current.stock_consumed_at) {
            consumeStockForCraftRequest(current, now);
        } else if (!crafted && current.stock_consumed_at) {
            restoreStockForCraftRequest(current, now);
        }

        db.prepare(`UPDATE craft_requests SET crafted = ?, serial_number = ?, craft_date = ?, crafted_by_id = ?, crafted_by_name = ?, status = CASE WHEN ? = 1 THEN 'crafted' ELSE 'in_progress' END WHERE id = ?`)
            .run(crafted ? 1 : 0, serial || null, crafted ? now : null, userId, userName, crafted ? 1 : 0, id);
    });
    tx();
}

function updateRequestSale(id, buyer_org, sale_price, sale_date, userId, userName) {
    db.prepare(`UPDATE craft_requests SET buyer_org = ?, sale_price = ?, sale_date = ?, completed_by_id = ?, completed_by_name = ?, status = 'completed' WHERE id = ?`)
        .run(buyer_org || null, sale_price ?? null, sale_date, userId, userName, id);
    invalidateCraftCaches();
}

function markRequestPosted(id) {
    db.prepare('UPDATE craft_requests SET posted_to_channel = 1 WHERE id = ?').run(id);
}

function getWeaponSaleStateForCraftRequest(request) {
    if (!request) return { state: 'not_listed' };
    const requestId = Number(request.id);
    const serial = String(request.serial_number || '').trim();
    let rows = [];
            if (requestId) {
            rows = db.prepare('SELECT * FROM my_weapons WHERE craft_request_id = ? ORDER BY id ASC').all(requestId);
        }
        if (!rows.length && serial) {
            rows = db.prepare('SELECT * FROM my_weapons WHERE serial_number = ? ORDER BY id ASC').all(serial);
        }

    if (!rows.length) return { state: 'not_listed' };
    const sold = rows.every(w => w.is_sold === true || w.is_sold === 1 || w.is_sold === '1');
    return {
        state: sold ? 'sold' : 'listed',
        my_weapon_id: rows[0].id,
        discord_message_id: rows.find(w => w.discord_message_id)?.discord_message_id || null,
    };
}

function getLinkedMyWeaponsForRequest(request) {
    if (!request) return [];
    const requestId = Number(request.id);
    const serial = String(request.serial_number || '').trim();
    const rowsByRequest = requestId
        ? db.prepare('SELECT * FROM my_weapons WHERE craft_request_id = ? ORDER BY id ASC').all(requestId)
        : [];
    const rowsBySerial = serial
        ? db.prepare('SELECT * FROM my_weapons WHERE serial_number = ? ORDER BY id ASC').all(serial)
        : [];
    return [...new Map([...rowsByRequest, ...rowsBySerial].map(row => [Number(row.id), row])).values()];
}

function serialAlreadyListed(serial, excludeId = null) {
    const clean = String(serial || '').trim();
    if (!clean) return false;
    const row = excludeId
        ? db.prepare('SELECT id FROM my_weapons WHERE serial_number = ? AND id != ? LIMIT 1').get(clean, excludeId)
        : db.prepare('SELECT id FROM my_weapons WHERE serial_number = ? LIMIT 1').get(clean);
    return !!row;
}

function getMyWeaponById(id) {
    const weaponId = Number(id);
    if (!weaponId) return null;
    return db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(weaponId) || null;
}

function deleteRequest(id) {
    db.prepare('DELETE FROM craft_requests WHERE id = ?').run(id);
}

function deleteCraftRequestCleanly(id) {
    const request = getRequest(id);
    if (!request) throw new Error('Demande introuvable');

    const runDelete = () => {
        const linkedWeapons = getLinkedMyWeaponsForRequest(request);
        const soldOrLogged = linkedWeapons.find(w =>
            w.is_sold === 1 || w.is_sold === true || w.is_sold === '1' ||
            w.sale_discord_message_id || w.weapons_log_message_id
        );
        if (soldOrLogged) {
            const err = new Error('Impossible de supprimer une demande déjà vendue ou loguée définitivement');
            err.statusCode = 409;
            throw err;
        }

        if (request.stock_consumed_at) {
            restoreStockForCraftRequest(request, Math.floor(Date.now() / 1000));
        }

                    if (linkedWeapons.length) {
                const deleteWeapon = db.prepare('DELETE FROM my_weapons WHERE id = ?');
                linkedWeapons.forEach(w => deleteWeapon.run(w.id));
            }
            db.prepare('DELETE FROM craft_requests WHERE id = ?').run(id);

        invalidateCraftCaches();
    };

    db.transaction(runDelete)();
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `weapon_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Format non supporté'));
    }
});

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

    app.get('/api/crafts/stocks', requireAuth, (req, res) => {
        try {
            res.json(getCraftableWeapons());
        } catch (e) {
            console.error('GET stocks:', e);
            res.status(500).json({ stocks: [], weapons: [], error: e.message });
        }
    });

    app.post('/api/admin/stocks/update', requireAdmin, (req, res) => {
        try {
            const updates = Array.isArray(req.body?.materials) ? req.body.materials : [req.body];
            for (const item of updates) {
                updateStockMaterial(item.ingredient_id, item.quantity);
            }
            res.json({ success: true, ...getCraftableWeapons() });
        } catch (e) {
            console.error('POST stocks update:', e);
            res.status(400).json({ success: false, error: e.message });
        }
    });

    app.get('/api/crafts/weapons', requireAuth, (req, res) => {
        try {
            const weapons = getAllWeapons();
            const allIngredients = getAllIngredients();
            const ingrMap = new Map(allIngredients.map(i => [i.name, i]));

            const list = weapons.map(w => {
                let parsedIngredients = typeof w.ingredients === 'string' ? JSON.parse(w.ingredients || '[]') : (w.ingredients || []);
                parsedIngredients = parsedIngredients.map(ing => {
                    const matched = ingrMap.get(ing.name) || (ing.ingredient_id ? allIngredients.find(i => i.id === ing.ingredient_id) : null);
                    return {
                        ...ing,
                        image_url: matched?.image_path ? `/crafts/images/${matched.image_path}` : null,
                    };
                });

                return {
                    ...w,
                    ingredients: parsedIngredients,
                    image_url: w.image_path ? `/crafts/images/${w.image_path}` : null,
                    plan_image_url: w.plan_image_path ? `/crafts/images/${w.plan_image_path}` : null,
                    requires_plan: !!w.requires_plan,
                };
            });

            // Trier par prix de vente décroissant, puis prix craft.
            list.sort((a, b) => {
                const saleDiff = (Number(b.sale_price) || 0) - (Number(a.sale_price) || 0);
                if (saleDiff !== 0) return saleDiff;
                const craftDiff = (Number(b.craft_price) || 0) - (Number(a.craft_price) || 0);
                if (craftDiff !== 0) return craftDiff;
                return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
            });

            res.json({ weapons: list });
        } catch (e) {
            console.error('GET weapons:', e);
            res.json({ weapons: [], error: e.message });
        }
    });

    app.post('/api/crafts/weapons', requireAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'plan_image', maxCount: 1 }]), (req, res) => {
        try {
            const { name, craft_time, craft_price, sale_price, max_sale_price, ingredients, requires_plan } = req.body;
            if (!name) return res.status(400).json({ error: 'Nom requis' });
            const imagePath = req.files?.image?.[0]?.filename || null;
            const planImagePath = req.files?.plan_image?.[0]?.filename || null;
            const id = insertWeapon(
                name, imagePath, planImagePath,
                requires_plan === '1' || requires_plan === 'true' || requires_plan === true,
                parseInt(craft_time) || 0,
                parseInt(craft_price) || 0,
                parseInt(sale_price) || 0,
                parseInt(max_sale_price) || 0,
                ingredients || '[]'
            );
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/crafts/weapons/:id', requireAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'plan_image', maxCount: 1 }]), (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { name, craft_time, craft_price, sale_price, max_sale_price, ingredients, requires_plan } = req.body;
            const existing = getWeapon(id);
            if (!existing) return res.status(404).json({ error: 'Arme introuvable' });

            const newImage = req.files?.image?.[0]?.filename || null;
            const newPlan = req.files?.plan_image?.[0]?.filename || null;

            if (newImage && existing.image_path) {
                const p = path.join(UPLOADS_DIR, existing.image_path);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            if (newPlan && existing.plan_image_path) {
                const p = path.join(UPLOADS_DIR, existing.plan_image_path);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }

            updateWeapon(
                id, name || existing.name, newImage, newPlan,
                requires_plan === '1' || requires_plan === 'true' || requires_plan === true,
                parseInt(craft_time) || existing.craft_time || 0,
                parseInt(craft_price) || existing.craft_price || 0,
                parseInt(sale_price) || existing.sale_price || 0,
                max_sale_price !== undefined ? (parseInt(max_sale_price) || 0) : (existing.max_sale_price || 0),
                ingredients || (typeof existing.ingredients === 'string' ? existing.ingredients : JSON.stringify(existing.ingredients || []))
            );
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/weapons/:id', requireAdmin, (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const existing = getWeapon(id);
            if (existing && existing.image_path) {
                const p = path.join(UPLOADS_DIR, existing.image_path);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            if (existing && existing.plan_image_path) {
                const p = path.join(UPLOADS_DIR, existing.plan_image_path);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            deleteWeapon(id);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── INGREDIENTS ─────────────
    app.get('/api/crafts/ingredients', requireAuth, (req, res) => {
        try {
            const list = getAllIngredients().map(i => ({
                ...i,
                image_url: i.image_path ? `/crafts/images/${i.image_path}` : null,
            }));
            res.json({ ingredients: list });
        } catch (e) { res.json({ ingredients: [], error: e.message }); }
    });

    app.post('/api/crafts/ingredients', requireAdmin, upload.single('image'), (req, res) => {
        try {
            const { name } = req.body;
            if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });
            const imagePath = req.file ? req.file.filename : null;
            const id = insertIngredient(name.trim(), imagePath);
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/crafts/ingredients/:id', requireAdmin, upload.single('image'), (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { name } = req.body;
            const existing = getIngredient(id);
            if (!existing) return res.status(404).json({ error: 'Ingrédient introuvable' });
            if (req.file && existing.image_path) {
                const p = path.join(UPLOADS_DIR, existing.image_path);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            updateIngredient(id, name || existing.name, req.file ? req.file.filename : null);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/ingredients/:id', requireAdmin, (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const existing = getIngredient(id);
            if (existing && existing.image_path) {
                const p = path.join(UPLOADS_DIR, existing.image_path);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            deleteIngredient(id);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/crafts/myweapon-names', requireAuth, (req, res) => {
        try { res.json({ names: getAllMyWeaponNamesWithPriceLimits() }); }
        catch (e) { res.json({ names: [], error: e.message }); }
    });

    app.post('/api/crafts/myweapon-names', requireAdmin, (req, res) => {
        try {
            const { name, sale_price, max_sale_price } = req.body;
            if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nom requis' });
            const id = insertMyWeaponName(name, sale_price, max_sale_price);
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/crafts/myweapon-names/:id', requireAdmin, (req, res) => {
        try {
            const { name, sale_price, max_sale_price } = req.body;
            updateMyWeaponName(parseInt(req.params.id), name, sale_price, max_sale_price);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/myweapon-names/:id', requireAdmin, (req, res) => {
        try {
            deleteMyWeaponName(parseInt(req.params.id));
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/crafts/organizations', requireAuth, (req, res) => {
        try { res.json({ organizations: getAllOrgs() }); }
        catch (e) { res.json({ organizations: [], error: e.message }); }
    });

    app.post('/api/crafts/organizations', requireAuth, (req, res) => {
        try {
            if (!canValidateCraft(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }
            const { name } = req.body;
            if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });
            const id = insertOrg(name.trim());
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/organizations/:id', requireAdmin, (req, res) => {
        try { deleteOrg(parseInt(req.params.id)); res.json({ success: true }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/order-advances', requireAdmin, (req, res) => {
        try {
            res.json({ advances: getOrderAdvances() });
        } catch (e) {
            res.status(500).json({ advances: [], error: e.message });
        }
    });

    app.post('/api/admin/order-advances', requireAdmin, (req, res) => {
        try {
            const id = upsertOrderAdvance(req.body || {});
            res.json({ success: true, id, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.put('/api/admin/order-advances/:id', requireAdmin, (req, res) => {
        try {
            const id = upsertOrderAdvance(req.body || {}, parseInt(req.params.id, 10));
            res.json({ success: true, id, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.put('/api/admin/order-advances/:id/settle', requireAdmin, (req, res) => {
        try {
            settleOrderAdvance(parseInt(req.params.id, 10));
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.delete('/api/admin/order-advances/:id', requireAdmin, (req, res) => {
        try {
            deleteOrderAdvance(parseInt(req.params.id, 10));
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/admin/order-advances/:id/repayments', requireAdmin, (req, res) => {
        try {
            const orderId = parseInt(req.params.id, 10);
            const repaymentId = saveOrderAdvanceRepayment(orderId, req.body || {});
            res.json({ success: true, id: repaymentId, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.put('/api/admin/order-advances/:id/repayments/:repaymentId', requireAdmin, (req, res) => {
        try {
            const orderId = parseInt(req.params.id, 10);
            const repaymentId = parseInt(req.params.repaymentId, 10);
            saveOrderAdvanceRepayment(orderId, req.body || {}, repaymentId);
            res.json({ success: true, id: repaymentId, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.delete('/api/admin/order-advances/:id/repayments/:repaymentId', requireAdmin, (req, res) => {
        try {
            deleteOrderAdvanceRepayment(parseInt(req.params.id, 10), parseInt(req.params.repaymentId, 10));
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.get('/api/crafts/requests', requireAuth, (req, res) => {
        try {
            if (req.query.view === 'board' && !isCraftManager(req.session.user)) {
                return res.status(403).json({ requests: [], error: 'Accès réservé aux hauts gradés' });
            }
            sweepRequestsForMissingMembers().catch(e => console.error('[craft] vérification membres absents:', e.message));
            const requests = getRequests(req.query.status, {
                productionOnly: req.query.view === 'board',
                hideTests: !isCraftManager(req.session.user),
            });
            const list = requests.map(r => ({
                ...r,
                weapon_image_url: r.weapon_image ? `/crafts/images/${r.weapon_image}` : null,
                sale_state: getWeaponSaleStateForCraftRequest(r).state,
                has_plan: !!r.has_plan, has_money: !!r.has_money, crafted: !!r.crafted,
            }));
            res.json({ requests: list });
        } catch (e) { res.json({ requests: [], error: e.message }); }
    });

    // Salons crafts
    const CRAFT_REQUEST_CHANNEL = '1501593802014720061';
    const CRAFT_STATUS_CHANNEL = '1496977220097282290';
    const CRAFT_PLAN_PROVIDER_ROLE = '1490361524408291459';
    const moneyLabel = (amount) => Number(amount) === 0 ? 'Gratuit' : (amount ? `${Number(amount).toLocaleString('fr-FR')}$` : 'N/A');

    // Helper : créer/éditer le message de demande de craft sur Discord
    async function postOrUpdateCraftRequestMessage(requestId) {
        try {
            const fullReq = getRequest(requestId);
            if (!fullReq) return;

            const channel = await fetchDiscordChannel(CRAFT_REQUEST_CHANNEL, 'CRAFT_REQUEST');
            if (!channel) return;

            const statusMeta = {
                pending: {
                    icon: '🟧',
                    label: 'Demande en attente',
                    color: 0xff8c00,
                    description: 'Demande enregistrée. Les pré-requis sont en cours de vérification.',
                },
                waiting_materials: {
                    icon: '📦',
                    label: 'En attente des matières premières',
                    color: 0xf59e0b,
                    description: 'Commande mise en attente : les matières premières doivent être fournies avant la construction.',
                },
                in_progress: {
                    icon: '🔨',
                    label: 'Ton arme est en cours de construction',
                    color: 0xfb923c,
                    description: 'La construction est lancée. Ton arme est en cours de construction.',
                },
                crafted: {
                    icon: '✅',
                    label: 'Craft terminé',
                    color: 0x22c55e,
                    description: 'L’arme est prête. La vente peut maintenant être renseignée.',
                },
                completed: {
                    icon: '✅',
                    label: 'Transaction clôturée',
                    color: 0x22c55e,
                    description: 'Le craft et la vente sont terminés. Le dossier est clôturé.',
                },
                rejected: {
                    icon: '⛔',
                    label: 'Demande refusée',
                    color: 0xef4444,
                    description: 'La demande a été refusée. Contacte un haut gradé si une précision est nécessaire.',
                },
            };
            const meta = statusMeta[fullReq.status] || statusMeta.pending;
            const prereqText = `Plan : ${fullReq.has_plan ? 'validé' : 'manquant'}\nFonds : ${fullReq.has_money ? 'validés' : 'manquants'}`;
            const serialLine = fullReq.serial_number ? `\nN° série : \`${fullReq.serial_number}\`` : '';
            const planProviderLine = fullReq.status === 'pending' ? `\n||<@&${CRAFT_PLAN_PROVIDER_ROLE}>||` : '';

            const contentByStatus = {
                pending:
                    `${meta.icon} **Nouvelle demande de Craft**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Arme demandée : **${fullReq.weapon_name}**\n` +
                    `Statut : **${meta.label}**\n\n` +
                    `Merci de fournir rapidement le plan d'arme et les Corps le plus rapidement possible.` +
                    planProviderLine,
                waiting_materials:
                    `${meta.icon} **Matières premières attendues**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Arme demandée : **${fullReq.weapon_name}**\n` +
                    `Statut : **${meta.label}**\n\n` +
                    `Les hauts gradés attendent les matières premières avant de lancer la construction.`,
                in_progress:
                    `${meta.icon} **Construction lancée**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Arme demandée : **${fullReq.weapon_name}**\n` +
                    `Statut : **${meta.label}**`,
                crafted:
                    `${meta.icon} **Arme craftée • ${fullReq.weapon_name}**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Statut : **${meta.label}**` +
                    serialLine,
                completed:
                    `${meta.icon} **Transaction clôturée • ${fullReq.weapon_name}**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Statut : **${meta.label}**`,
                rejected:
                    `${meta.icon} **Demande de craft refusée**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Arme demandée : **${fullReq.weapon_name}**\n` +
                    `Statut : **${meta.label}**`,
            };
            const content = contentByStatus[fullReq.status] || contentByStatus.pending;

            const { EmbedBuilder } = require('discord.js');
            const embedFields = [
                { name: 'Demandeur', value: fullReq.user_name || 'N/A', inline: true },
                { name: 'Statut', value: meta.label, inline: true },
                { name: 'Pré-requis', value: prereqText, inline: true },
            ];
            if (fullReq.serial_number) {
                embedFields.push({ name: 'Numéro de série', value: `\`${fullReq.serial_number}\``, inline: true });
            }

            const embed = new EmbedBuilder()
                .setTitle(`Demande de Craft • ${fullReq.weapon_name}`)
                .setDescription(meta.description)
                .setColor(meta.color)
                .addFields(...embedFields)
                .setTimestamp()
                .setFooter({ text: '21 Block Savage • Suivi craft' });

            const allowedMentions = {
                users: [fullReq.user_id],
                roles: fullReq.status === 'pending' ? [CRAFT_PLAN_PROVIDER_ROLE] : [],
            };

            if (fullReq.discord_message_id) {
                try {
                    const msg = await channel.messages.fetch(fullReq.discord_message_id);
                    await msg.edit({ content, embeds: [embed], allowedMentions });
                    return;
                } catch (e) {
                    console.error('Édition message craft échouée, création nouveau:', e.message);
                }
            }

            const msg = await channel.send({ content, embeds: [embed], allowedMentions });

                            db.prepare('UPDATE craft_requests SET discord_message_id = ? WHERE id = ?').run(msg.id, requestId);

        } catch (e) {
            console.error('Erreur postOrUpdateCraftRequestMessage:', e.message);
        }
    }
    // Helper : message de notification de changement de statut dans CRAFT_STATUS_CHANNEL
    async function postCraftStatusUpdate(requestId, newStatus) {
        try {
            const fullReq = getRequest(requestId);
            if (!fullReq) return;
            const channel = await fetchDiscordChannel(CRAFT_STATUS_CHANNEL, 'CRAFT_STATUS');
            if (!channel) return;

            const statusMeta = {
                pending: {
                    content: `🟧 <@${fullReq.user_id}> ta demande de craft est remise en attente.`,
                    title: 'Demande en attente',
                    description: `La demande **${fullReq.weapon_name}** est à nouveau en attente de validation.`,
                    color: 0xff8c00,
                },
                waiting_materials: {
                    content: `📦 <@${fullReq.user_id}> ta commande attend les matières premières.`,
                    title: 'Matières premières attendues',
                    description: `La construction de **${fullReq.weapon_name}** commencera dès que les matières premières seront fournies.`,
                    color: 0xf59e0b,
                },
                in_progress: {
                    content: `🔨 <@${fullReq.user_id}> ton arme est en cours de construction.`,
                    title: 'Construction lancée',
                    description: `Ton arme **${fullReq.weapon_name}** est en cours de construction.`,
                    color: 0xfb923c,
                },
                rejected: {
                    content: `⛔ <@${fullReq.user_id}> ta demande de craft a été refusée.`,
                    title: 'Demande refusée',
                    description: `La demande **${fullReq.weapon_name}** a été refusée. Contacte un haut gradé si besoin.`,
                    color: 0xef4444,
                },
            };
            const meta = statusMeta[newStatus];
            if (!meta) return;

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle(`Craft d’armes • ${meta.title}`)
                .setDescription(meta.description)
                .setColor(meta.color)
                .addFields(
                    { name: 'Arme', value: fullReq.weapon_name || 'N/A', inline: true },
                    { name: 'Demandeur', value: fullReq.user_name || 'N/A', inline: true },
                )
                .setTimestamp()
                .setFooter({ text: '21 Block Savage • Suivi craft' });

            await channel.send({
                content: meta.content,
                embeds: [embed],
                allowedMentions: { users: [fullReq.user_id] },
            });
        } catch (e) {
            console.error('Erreur postCraftStatusUpdate:', e.message);
        }
    }
    app.post('/api/crafts/requests', requireAuth, async (req, res) => {
        try {
            const { weapon_id, has_plan, has_money, request_type, is_test } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            if (!weapon_id) return res.status(400).json({ error: 'Arme requise' });
            const normalizedType = normalizeCraftRequestType(request_type);
            if (!normalizedType) return res.status(400).json({ error: 'Type de demande obligatoire' });
            const weapon = getWeapon(weapon_id);
            if (!weapon) return res.status(404).json({ error: 'Arme introuvable' });
            const requestIsTest = !!is_test && isCraftManager(req.session.user);
            if (is_test && !requestIsTest) {
                return res.status(403).json({ error: 'Mode test réservé aux hauts gradés' });
            }
            const id = insertRequest(userId, userName, weapon_id, has_plan, has_money, normalizedType, requestIsTest);

            // Message Discord
            if (!requestIsTest) {
                postOrUpdateCraftRequestMessage(id).catch(e => console.error('post craft request async:', e.message));
            }

            emitRealtime('craft:status', { requestId: id, status: 'pending', action: 'created' });
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

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

    async function postManualCraftSaleJustification(requestId, saleTimestamp) {
        const updated = getRequest(requestId);
        if (!updated || updated.posted_to_channel) return;

        const state = botState();
        const channelId = (state?.CONFIG?.CHANNELS?.WEAPONS_LOG) || '1497021044953845791';
        const channel = await fetchDiscordChannel(channelId, 'WEAPONS_LOG_MANUAL_CRAFT');
        if (!channel) return;

        const saleDate = saleTimestamp ? new Date(saleTimestamp * 1000).toLocaleDateString('fr-FR') : 'N/A';
        const sellerLabel = updated.completed_by_id && updated.completed_by_id !== 'former-21bs'
            ? `<@${updated.completed_by_id}>`
            : (updated.completed_by_name || 'N/A');
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle(`Justification de vente • ${updated.weapon_name}`)
            .setDescription('Craft manuel archivé comme vente finalisée.')
            .setColor(0xffb84d)
            .addFields(
                { name: 'Vendeur', value: sellerLabel, inline: true },
                { name: 'Numéro de série', value: `\`${updated.serial_number || 'N/A'}\``, inline: true },
                { name: 'Acheteur', value: updated.buyer_org || 'N/A', inline: true },
                { name: 'Prix final', value: moneyLabel(updated.sale_price), inline: true },
                { name: 'Date vente', value: saleDate, inline: true },
            );

        await channel.send({
            content: `✅ Vente archivée • **${updated.weapon_name}**`,
            embeds: [embed],
            allowedMentions: { parse: [] },
        });
        markRequestPosted(requestId);
    }

    app.post('/api/crafts/requests/manual', requireAuth, async (req, res) => {
        try {
            if (!canValidateCraft(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }

            const {
                weapon_id,
                serial_number,
                craft_date,
                crafted_by_id,
                crafted_by_name,
                is_sold,
                buyer_org,
                sale_price,
                sale_date,
                sold_by_id,
                sold_by_name,
                free_sale,
            } = req.body;
            const weapon = getWeapon(parseInt(weapon_id));
            if (!weapon) return res.status(404).json({ error: 'Arme introuvable' });
            if (!serial_number || !String(serial_number).trim()) return res.status(400).json({ error: 'N° de série obligatoire' });
            if (!craft_date) return res.status(400).json({ error: 'Date craft obligatoire' });
            if (is_sold && !buyer_org) return res.status(400).json({ error: 'Organisation acheteuse obligatoire si vendu' });
            if (is_sold && !sale_date) return res.status(400).json({ error: 'Date de vente obligatoire si vendu' });
            const authorizedCrafter = resolveAuthorizedCrafter(crafted_by_id, crafted_by_name);
            if (!authorizedCrafter) return res.status(400).json({ error: 'Armurier obligatoire : Otelow, Ney ou Le H' });

            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const userAvatar = req.session.user.avatar || null;
            const soldById = String(sold_by_id || '').trim();
            const soldByName = String(sold_by_name || '').trim();
            const serial = String(serial_number).trim();
            const craftTimestamp = Math.floor(new Date(`${craft_date}T12:00:00+01:00`).getTime() / 1000);
            if (!Number.isFinite(craftTimestamp)) return res.status(400).json({ error: 'Date craft invalide' });
            const sold = !!is_sold;
            if (sold && !soldById) return res.status(400).json({ error: 'Vendeur obligatoire si vendu' });
            const now = Math.floor(Date.now() / 1000);
            const saleTimestamp = sold ? Math.floor(new Date(`${sale_date}T12:00:00+01:00`).getTime() / 1000) : null;
            if (sold && !Number.isFinite(saleTimestamp)) return res.status(400).json({ error: 'Date de vente invalide' });
            const soldPrice = free_sale ? 0 : (parseInt(sale_price) || null);
            const status = sold ? 'completed' : 'crafted';
            let requestId;
            let myWeaponId;

                            const r = db.prepare(`
                    INSERT INTO craft_requests (
                        user_id, user_name, weapon_id, has_plan, has_money, status, crafted,
                        serial_number, craft_date, crafted_by_id, crafted_by_name,
                        buyer_org, sale_price, sale_date, completed_by_id, completed_by_name
                    ) VALUES (?, ?, ?, 1, 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    userId, userName, weapon.id, status, serial, craftTimestamp,
                    authorizedCrafter.id, authorizedCrafter.name, sold ? buyer_org : null, soldPrice,
                    sold ? saleTimestamp : null, sold ? soldById : null, sold ? soldByName : null
                );
                requestId = r.lastInsertRowid;

                const mw = db.prepare(`
                    INSERT INTO my_weapons (
                        user_id, user_name, user_avatar, weapon_name, is_crafted, serial_number,
                        asking_price, min_price, is_sold, sold_to, sold_price, sold_at,
                        crafted_by_id, crafted_by_name, sold_by_id, sold_by_name
                    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    userId, userName, userAvatar, weapon.name, serial, soldPrice, null,
                    sold ? 1 : 0, sold ? buyer_org : null, soldPrice, sold ? saleTimestamp : null,
                    authorizedCrafter.id, authorizedCrafter.name, sold ? soldById : null, sold ? soldByName : null
                );
                myWeaponId = mw.lastInsertRowid;


            if (sold) {
                try {
                    await postManualCraftSaleJustification(requestId, saleTimestamp);
                } catch (e) {
                    console.error('Erreur justification craft manuel:', e.message);
                }
            }

            res.json({ success: true, id: requestId, myWeaponId });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.patch('/api/crafts/requests/:id/craft', requireAuth, async (req, res) => {
        try {
            if (!canValidateCraft(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }
            const id = parseInt(req.params.id);
            const { crafted, serial_number } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const existing = getRequest(id);
            if (!existing) return res.status(404).json({ error: 'Demande introuvable' });
            updateRequestCraft(id, crafted, serial_number, userId, userName);

            // Mettre à jour le message Discord original
            if (!existing.is_test) {
                postOrUpdateCraftRequestMessage(id).catch(e => console.error('post craft request async:', e.message));
            }

            if (crafted && !existing.is_test) {
                const channel = await fetchDiscordChannel(CRAFT_STATUS_CHANNEL, 'CRAFT_STATUS_READY');
                if (channel) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`Arme prête • ${existing.weapon_name}`)
                        .setDescription('La construction est terminée. Renseigne la vente quand la transaction est effectuée.')
                        .setColor(0x22c55e)
                        .addFields(
                            { name: 'Demandeur', value: existing.user_name || 'N/A', inline: true },
                            { name: 'Numéro de série', value: `\`${serial_number || 'N/A'}\``, inline: true },
                            { name: 'Prochaine étape', value: 'Compléter le prix de vente, le groupe acheteur et la date de vente.', inline: false },
                        )
                        .setTimestamp()
                        .setFooter({ text: '21 Block Savage • Atelier craft' });

                    channel.send({
                        content: `✅ <@${existing.user_id}> ton arme est prête : **${existing.weapon_name}**.`,
                        embeds: [embed],
                        allowedMentions: { users: [existing.user_id] },
                    }).catch(e => console.error('Erreur notification craft terminé:', e.message));
                }
            }
            emitRealtime('craft:status', { requestId: id, status: crafted ? 'crafted' : 'in_progress', action: 'crafted' });
            res.json({ success: true });
        } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
    });

    // Changement de statut (En attente / Matières / En cours / Refusé)
    app.patch('/api/crafts/requests/:id/status', requireAuth, async (req, res) => {
        try {
            if (!canValidateCraft(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }
            const id = parseInt(req.params.id);
            const { status } = req.body;
            const allowed = ['pending', 'waiting_materials', 'in_progress', 'rejected'];
            if (!allowed.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

                            db.prepare('UPDATE craft_requests SET status = ? WHERE id = ?').run(status, id);

            invalidateCraftCaches();

            const updatedForDiscord = getRequest(id);
            if (!updatedForDiscord?.is_test) {
                // Mettre à jour le message Discord original (édition embed)
                postOrUpdateCraftRequestMessage(id).catch(e => console.error('post craft request async:', e.message));

                // Notification dans le salon de statut
                postCraftStatusUpdate(id, status).catch(e => console.error('post craft status async:', e.message));
            }

            emitRealtime('craft:status', { requestId: id, status, action: 'status' });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.patch('/api/crafts/requests/:id/sale', requireAuth, async (req, res) => {
        return res.status(410).json({
            error: 'Route legacy désactivée. Utiliser le workflow Vos Armes / Marquer vendu.'
        });
    });

    // Annuler/supprimer sa propre demande (pour le demandeur uniquement, ou super admin)
    app.delete('/api/crafts/requests/:id/cancel', requireAuth, (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const userId = req.session.user.id;
            const existing = getRequest(id);
            if (!existing) return res.status(404).json({ error: 'Demande introuvable' });

            // Le demandeur peut annuler uniquement une demande encore en attente.
            // Les hauts gradés passent par la suppression propre pour restaurer le stock/liens éventuels.
            const isOwner = existing.user_id === userId;
            const isSuperAdmin = canDeleteRequests(req.session.user);

            if (!isOwner && !isSuperAdmin) {
                return res.status(403).json({ error: 'Tu peux annuler uniquement tes propres demandes' });
            }
            if (isSuperAdmin) {
                deleteCraftRequestCleanly(id);
                emitRealtime('craft:status', { requestId: id, status: 'deleted', action: 'deleted' });
                return res.json({ success: true });
            }
            if (existing.status !== 'pending') {
                return res.status(403).json({ error: 'Demande déjà active, contacte un haut gradé' });
            }

            deleteRequest(id);
            emitRealtime('craft:status', { requestId: id, status: 'deleted', action: 'cancelled' });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/requests/:id', requireAuth, (req, res) => {
        try {
            if (!isCraftManager(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }
            deleteCraftRequestCleanly(parseInt(req.params.id));
            emitRealtime('craft:status', { requestId: parseInt(req.params.id), status: 'deleted', action: 'deleted' });
            res.json({ success: true });
        } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
    });

    // ─── MY WEAPONS ─────────────────────
    const MYWEAPONS_CHANNEL = '1497185767053594695';
    const MYWEAPONS_AUTHORIZED_CRAFTERS = [
        { id: 'otelow', name: 'Otelow' },
        { id: 'ney', name: 'Ney' },
        { id: 'le-h', name: 'Le H' },
    ];

    const maxSalePriceError = (max) => `Le prix ne peut pas dépasser le prix maximal autorisé pour cette arme : ${Number(max).toLocaleString('fr-FR')}$.`;

    function validateMyWeaponPriceLimit({ weaponName, weaponId, askingPrice, minPrice }) {
        const adminWeapon = weaponId ? getWeapon(weaponId) : getWeaponByName(weaponName);
        const myWeaponName = getMyWeaponNameByName(weaponName);
        const adminMaxSalePrice = Number(adminWeapon?.max_sale_price) || 0;
        const maxSalePrice = adminMaxSalePrice > 0 ? adminMaxSalePrice : (Number(myWeaponName?.max_sale_price) || 0);
        if (maxSalePrice <= 0) return null;
        const prices = [askingPrice, minPrice].filter(value => value !== null && typeof value !== 'undefined');
        return prices.some(value => Number(value) > maxSalePrice) ? maxSalePriceError(maxSalePrice) : null;
    }

    function resolveAuthorizedCrafter(craftedById, craftedByName) {
        const rawId = String(craftedById || '').trim().toLowerCase();
        const rawName = String(craftedByName || '').trim().toLowerCase();
        return MYWEAPONS_AUTHORIZED_CRAFTERS.find(c =>
            c.id.toLowerCase() === rawId ||
            c.name.toLowerCase() === rawName ||
            c.name.toLowerCase() === rawId
        ) || null;
    }

    function normalizeSerialList(input) {
        const raw = Array.isArray(input) ? input.join('\n') : String(input || '');
        return [...new Set(raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean))];
    }

    function aggregateMyWeapons(list, userId) {
        const grouped = new Map();
        for (const item of list) {
            const key = item.batch_id || `single-${item.id}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    ...item,
                    group_id: key,
                    serials: [],
                    sold_serials: [],
                    row_ids: [],
                    available_row_ids: [],
                    quantity_total: 0,
                    quantity_available: 0,
                    is_mine: item.user_id === userId,
                });
            }
            const group = grouped.get(key);
            group.quantity_total++;
            group.row_ids.push(item.id);
            const serialEntry = {
                id: item.id,
                serial_number: item.serial_number,
                is_sold: !!item.is_sold,
                sold_to: item.sold_to,
                sold_price: item.sold_price,
                sold_at: item.sold_at,
                sold_by_id: item.sold_by_id,
                sold_by_name: item.sold_by_name,
            };
            group.serials.push(serialEntry);
            if (item.is_sold) group.sold_serials.push(serialEntry);
            if (!item.is_sold) {
                group.quantity_available++;
                group.available_row_ids.push(item.id);
                group.id = item.id;
                group.is_sold = 0;
                group.sold_to = null;
                group.sold_price = null;
                group.sold_at = null;
            }
        }
        return [...grouped.values()].sort((a, b) => {
            if ((a.quantity_available > 0) !== (b.quantity_available > 0)) return a.quantity_available > 0 ? -1 : 1;
            return (b.created_at || 0) - (a.created_at || 0);
        });
    }

    function buildMyWeaponsEmbed(weapon, rows) {
        const { EmbedBuilder } = require('discord.js');
        const total = rows.length;
        const available = rows.filter(w => !w.is_sold).length;
        const serials = rows
            .map(w => `${w.is_sold ? 'Vendu' : 'Disponible'} • ${w.serial_number || 'N° non renseigne'}${w.sold_to ? ` → ${w.sold_to}` : ''}${w.sold_by_name ? ` • vendu par ${w.sold_by_name}` : ''}`)
            .join('\n')
            .slice(0, 1000) || 'N/A';

        return new EmbedBuilder()
            .setTitle(`Marché armurerie • ${weapon.weapon_name}`)
            .setDescription(available > 0 ? `Stock disponible : ${available}/${total} arme(s).` : 'Lot vendu entièrement.')
            .setColor(available > 0 ? 0xff8c00 : 0x22c55e)
            .addFields(
                { name: 'Vendeur', value: weapon.user_name || 'N/A', inline: true },
                { name: 'Origine', value: weapon.is_crafted ? 'Craft 21BS validé' : 'Arme externe', inline: true },
                { name: 'Craftée par', value: weapon.is_crafted ? (weapon.crafted_by_name || 'Non renseigné') : 'Arme externe', inline: true },
                { name: 'Stock', value: `${available}/${total} disponible(s)`, inline: true },
                { name: 'Prix affiché', value: moneyLabel(weapon.asking_price), inline: true },
                { name: 'Seuil minimum', value: moneyLabel(weapon.min_price), inline: true },
                { name: 'N° série', value: serials, inline: false },
            )
            .setTimestamp()
            .setFooter({ text: '21 Block Savage • Marché armurerie' });
    }
    async function updateMyWeaponsDiscordBatch(existing) {
        let rows;
                    rows = existing.batch_id
                ? db.prepare('SELECT * FROM my_weapons WHERE batch_id = ? ORDER BY id ASC').all(existing.batch_id)
                : [db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(existing.id)];

        rows = rows.filter(Boolean);
        if (!rows.length) return;

        const base = rows[0];
        const available = rows.filter(w => !w.is_sold).length;
        const channel = await fetchDiscordChannel(MYWEAPONS_CHANNEL, 'MYWEAPONS_LISTING');
        if (!channel) return;
        const embed = buildMyWeaponsEmbed(base, rows);
        const content = available > 0
            ? `📦 Vente armurerie • **${base.weapon_name}** • ${available}/${rows.length} disponible(s).`
            : `✅ Vente armurerie clôturée • **${base.weapon_name}** • lot vendu.`;
        const messageId = rows.find(w => w.discord_message_id)?.discord_message_id;
        if (messageId) {
            try {
                const msg = await channel.messages.fetch(messageId);
                await msg.edit({ content, embeds: [embed], allowedMentions: { parse: [] } });
                return;
            } catch {}
        }
        const msg = await channel.send({ content, embeds: [embed], allowedMentions: { parse: [] } });
                    if (base.batch_id) db.prepare('UPDATE my_weapons SET discord_message_id = ? WHERE batch_id = ?').run(msg.id, base.batch_id);
            else db.prepare('UPDATE my_weapons SET discord_message_id = ? WHERE id = ?').run(msg.id, base.id);

    }

    async function fetchDiscordChannel(channelId, label) {
        if (!botClient) {
            console.error(`[discord] ${label}: botClient indisponible`);
            return null;
        }
        const cached = botClient.channels.cache.get(channelId);
        if (cached) return cached;
        try {
            return await botClient.channels.fetch(channelId);
        } catch (e) {
            console.error(`[discord] ${label}: salon ${channelId} introuvable ou inaccessible: ${e.message}`);
            return null;
        }
    }

    function getWeaponsLogChannelId() {
        const state = botState();
        return (state?.CONFIG?.CHANNELS?.WEAPONS_LOG) || '1497021044953845791';
    }

    function getSaleLogReadyRows(existing) {
        let rows;
                    rows = existing.batch_id
                ? db.prepare('SELECT * FROM my_weapons WHERE batch_id = ? ORDER BY id ASC').all(existing.batch_id)
                : [db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(existing.id)];


        return rows
            .filter(Boolean)
            .filter(w => {
                const crafted = w.is_crafted === true || w.is_crafted === 1 || w.is_crafted === '1';
                const sold = w.is_sold === true || w.is_sold === 1 || w.is_sold === '1';
                const hasPrice = w.sold_price !== null && typeof w.sold_price !== 'undefined' && String(w.sold_price).trim() !== '';
                return crafted
                    && sold
                    && !w.sale_discord_message_id
                    && String(w.serial_number || '').trim()
                    && String(w.sold_to || '').trim()
                    && hasPrice;
            });
    }

    function buildMyWeaponsSaleLogEmbed(base, rows) {
        const { EmbedBuilder } = require('discord.js');
        const serialValues = rows
            .map(w => String(w.serial_number || '').trim())
            .filter(Boolean);
        const serials = serialValues.length <= 1
            ? (serialValues[0] ? `\`${serialValues[0]}\`` : 'N/A')
            : serialValues
                .map((serial, index) => `${index + 1}. \`${serial}\``)
                .join('\n')
                .slice(0, 1000);
        const saleDates = [...new Set(rows
            .map(w => w.sold_at ? new Date(w.sold_at * 1000).toLocaleDateString('fr-FR') : null)
            .filter(Boolean))];
        const saleDate = saleDates.length === 1 ? saleDates[0] : new Date().toLocaleDateString('fr-FR');
        const soldByLabel = base.sold_by_id && base.sold_by_id !== 'former-21bs'
            ? `<@${base.sold_by_id}>`
            : (base.sold_by_name || base.user_name || 'N/A');
        const declaredById = String(base.created_by_id || '').trim();
        const soldById = String(base.sold_by_id || '').trim();
        const ownerId = String(base.user_id || '').trim();
        const shouldShowDeclaredBy = declaredById
            && declaredById !== 'former-21bs'
            && declaredById !== soldById
            && declaredById !== ownerId;
        const declaredByLabel = shouldShowDeclaredBy
            ? `<@${declaredById}>`
            : null;

        const fields = [
            { name: 'Arme', value: base.weapon_name || 'N/A', inline: true },
            { name: 'Quantité', value: String(rows.length), inline: true },
            { name: 'Acheteur', value: base.sold_to || 'N/A', inline: true },
            { name: 'Montant vendu', value: moneyLabel(base.sold_price), inline: true },
            { name: 'Date de vente', value: saleDate, inline: true },
            { name: 'Vendeur', value: soldByLabel, inline: true },
        ];

        if (declaredByLabel) {
            fields.push({ name: 'Déclarée par', value: declaredByLabel, inline: true });
        }

        fields.push(
            { name: 'Craftée par', value: base.crafted_by_name || 'Non renseigné', inline: true },
            { name: serialValues.length > 1 ? 'Numéros de série' : 'Numéro de série', value: serials, inline: false },
        );

        return new EmbedBuilder()
            .setTitle('✅ Vente d’arme 21BS')
            .setDescription('Une arme craftée par les 21 Block Savage vient d’être déclarée vendue.')
            .setColor(0x22c55e)
            .addFields(...fields);
    }

    async function postMyWeaponsSaleLog(existing) {
        const rows = getSaleLogReadyRows(existing);
        if (!rows.length) return false;

        const channelId = getWeaponsLogChannelId();
        const channel = await fetchDiscordChannel(channelId, 'WEAPONS_LOG');
        if (!channel) return false;

        const base = rows[0];
        const embed = buildMyWeaponsSaleLogEmbed(base, rows);
        try {
            const msg = await channel.send({
                content: `✅ Vente déclarée • **${base.weapon_name}** • ${rows.length} série${rows.length > 1 ? 's' : ''}`,
                embeds: [embed],
                allowedMentions: { parse: [] },
            });
                            const stmt = db.prepare('UPDATE my_weapons SET sale_discord_message_id = ? WHERE id = ?');
                for (const row of rows) stmt.run(msg.id, row.id);

            return true;
        } catch (e) {
            console.error(`[discord] WEAPONS_LOG: log vente impossible pour ${base.weapon_name}: ${e.message}`);
            return false;
        }
    }

    app.get('/api/crafts/myweapons', requireAuth, (req, res) => {
        try {
            const userId = req.session.user.id;
            // Tout le monde voit toutes les armes en vente, mais on note l'auteur
            let list;
                            list = db.prepare('SELECT * FROM my_weapons ORDER BY is_sold ASC, created_at DESC').all();

            res.json({ myweapons: aggregateMyWeapons(list, userId) });
        } catch (e) { res.json({ myweapons: [], error: e.message }); }
    });

    app.get('/api/crafts/myweapons/available-crafts', requireAuth, (req, res) => {
        try {
            const requesterId = req.session.user.id;
            const requestedUserId = String(req.query.userId || '').trim();
            const viewingOtherUser = requestedUserId && requestedUserId !== requesterId;
            if (viewingOtherUser && !canValidateCraft(req.session.user) && !canDeleteMyWeapons(req.session.user)) {
                return res.status(403).json({ crafts: [], error: 'Action non autorisée' });
            }
            const userId = viewingOtherUser ? requestedUserId : requesterId;
            let rows;
                            rows = db.prepare(`
                    SELECT r.*, w.name as weapon_name, w.max_sale_price as max_sale_price
                    FROM craft_requests r
                    JOIN weapons w ON r.weapon_id = w.id
                    WHERE r.user_id = ?
                      AND r.status = 'crafted'
                      AND TRIM(COALESCE(r.serial_number, '')) != ''
                    ORDER BY r.craft_date DESC, r.created_at DESC
                `).all(userId);

            const crafts = rows
                .filter(r => getWeaponSaleStateForCraftRequest(r).state === 'not_listed')
                .map(r => ({
                    id: r.id,
                    user_id: r.user_id,
                    user_name: r.user_name,
                    weapon_name: r.weapon_name,
                    max_sale_price: Number(r.max_sale_price) || 0,
                    serial_number: r.serial_number,
                    craft_date: r.craft_date,
                    crafted_by_id: r.crafted_by_id,
                    crafted_by_name: r.crafted_by_name,
                }));
            res.json({ crafts });
        } catch (e) {
            res.status(500).json({ crafts: [], error: e.message });
        }
    });

    app.post('/api/crafts/myweapons', requireAuth, async (req, res, next) => {
        try {
            const {
                weapon_name,
                is_crafted,
                serial_number,
                serial_numbers,
                quantity,
                asking_price,
                min_price,
                crafted_by_id,
                crafted_by_name,
                sell_for_user_id,
                sell_for_user_name,
                craft_request_id,
            } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const userAvatar = req.session.user.avatar || null;
            const targetUserId = String(sell_for_user_id || '').trim();
            const targetUserName = String(sell_for_user_name || '').trim();
            const sellingForOther = targetUserId && targetUserId !== userId;
            if (sellingForOther && !canValidateCraft(req.session.user) && !canDeleteMyWeapons(req.session.user)) {
                return res.status(403).json({ error: 'Tu ne peux pas vendre au nom d’un autre membre' });
            }
            const ownerId = sellingForOther ? targetUserId : userId;
            const ownerName = sellingForOther ? (targetUserName || targetUserId) : userName;
            const ownerAvatar = sellingForOther ? await getDiscordUserAvatar(ownerId) : userAvatar;
            const createdById = sellingForOther ? userId : null;
            const createdByName = sellingForOther ? userName : null;
            const requestedWeaponName = String(weapon_name || '').trim();
            if (!requestedWeaponName) return res.status(400).json({ error: "Nom de l'arme requis" });
            const allowedWeaponNames = getAllMyWeaponNames();
            const matchedWeaponName = allowedWeaponNames.find(w => String(w.name || '').toLowerCase() === requestedWeaponName.toLowerCase());
            if (allowedWeaponNames.length && !matchedWeaponName) {
                return res.status(400).json({ error: "Choisis une arme dans la liste autorisée" });
            }
            const weaponName = matchedWeaponName ? matchedWeaponName.name : requestedWeaponName;
            if (typeof is_crafted === 'undefined') return res.status(400).json({ error: "Origine de l'arme obligatoire" });
            const isCrafted21BS = is_crafted === true || is_crafted === 1 || is_crafted === '1' || is_crafted === 'true';
            const linkedCraftRequestId = parseInt(craft_request_id, 10) || null;
            let linkedCraftRequest = null;
            if (linkedCraftRequestId) {
                if (!isCrafted21BS) {
                    return res.status(400).json({ error: 'Une demande de craft liée doit être déclarée comme arme craftée 21BS' });
                }
                linkedCraftRequest = getRequest(linkedCraftRequestId);
                if (!linkedCraftRequest) return res.status(404).json({ error: 'Demande de craft introuvable' });
                if (String(linkedCraftRequest.user_id || '') !== String(ownerId || '')) {
                    return res.status(400).json({ error: 'La mise en vente doit être faite au nom du demandeur du craft' });
                }
                if (linkedCraftRequest.user_id !== ownerId && !canValidateCraft(req.session.user) && !canDeleteMyWeapons(req.session.user)) {
                    return res.status(403).json({ error: 'Tu ne peux pas lier une demande de craft qui ne t’appartient pas' });
                }
                if (linkedCraftRequest.status !== 'crafted' || !String(linkedCraftRequest.serial_number || '').trim()) {
                    return res.status(400).json({ error: 'Cette demande de craft n’est pas prête à la vente' });
                }
                if (getWeaponSaleStateForCraftRequest(linkedCraftRequest).state !== 'not_listed') {
                    return res.status(409).json({ error: 'Cette arme est déjà en vente ou déjà vendue' });
                }
            }
            const authorizedCrafter = isCrafted21BS ? resolveAuthorizedCrafter(crafted_by_id, crafted_by_name) : null;
            if (isCrafted21BS && !authorizedCrafter) {
                return res.status(400).json({ error: "Armurier autorisé obligatoire : Otelow, Ney ou Le H" });
            }

            let serials = normalizeSerialList(serial_numbers || serial_number);
            if (linkedCraftRequest) {
                serials = [String(linkedCraftRequest.serial_number).trim()];
            }
            const requestedQuantity = Math.min(50, Math.max(1, parseInt(quantity, 10) || serials.length || 1));
            if (isCrafted21BS && serials.length !== requestedQuantity) {
                return res.status(400).json({ error: `Renseigne ${requestedQuantity} N° de série distinct${requestedQuantity > 1 ? 's' : ''}` });
            }
            if (!isCrafted21BS && serials.length < requestedQuantity) {
                serials = [...serials, ...Array(requestedQuantity - serials.length).fill(null)];
            }
            const duplicateSerial = serials.find(serial => serial && serialAlreadyListed(serial));
            if (duplicateSerial) {
                return res.status(409).json({ error: `Le N° de série ${duplicateSerial} est déjà en vente ou vendu` });
            }

            const askingPrice = parseInt(asking_price) || null;
            const minPrice = parseInt(min_price) || null;
            const priceLimitError = validateMyWeaponPriceLimit({
                isCrafted21BS,
                weaponName,
                weaponId: linkedCraftRequest?.weapon_id || null,
                askingPrice,
                minPrice,
            });
            if (priceLimitError) return res.status(400).json({ error: priceLimitError });
            const craftedById = linkedCraftRequest?.crafted_by_id || (isCrafted21BS ? authorizedCrafter.id : null);
            const craftedByName = linkedCraftRequest?.crafted_by_name || (isCrafted21BS ? authorizedCrafter.name : null);
            const batchId = `mw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            let id;

                            const stmt = db.prepare(`INSERT INTO my_weapons (user_id, user_name, user_avatar, weapon_name, craft_request_id, is_crafted, serial_number, asking_price, min_price, batch_id, crafted_by_id, crafted_by_name, created_by_id, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                for (const serial of serials) {
                    const r = stmt.run(ownerId, ownerName, ownerAvatar, weaponName, linkedCraftRequestId, isCrafted21BS ? 1 : 0, serial, askingPrice, minPrice, batchId, craftedById, craftedByName, createdById, createdByName);
                    if (!id) id = r.lastInsertRowid;
                }


            try {
                const first = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);
                if (first) {
                    await updateMyWeaponsDiscordBatch(first);
                }
            } catch (e) { console.error('Erreur post Discord myweapons:', e.message); }

            emitRealtime('craft:status', { requestId: linkedCraftRequestId || null, myWeaponId: id, status: 'listed', action: 'myweapon-listed' });
            return res.json({ success: true, id, quantity: serials.length });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/crafts/myweapons-legacy', requireAuth, async (req, res) => {
        return res.status(410).json({ error: 'Endpoint legacy desactive. Utilise /api/crafts/myweapons.' });
    });

    app.get('/api/crafts/myweapons/:id', requireAuth, (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const existing = getMyWeaponById(id);
            if (!existing) return res.status(404).json({ error: 'Annonce introuvable' });
            const canManageAny = canValidateCraft(req.session.user) || canDeleteMyWeapons(req.session.user);
            if (String(existing.user_id) !== String(req.session.user.id) && !canManageAny) {
                return res.status(403).json({ error: 'Action non autorisee' });
            }
            if (!canManageAny && existing.is_sold) {
                return res.status(403).json({ error: 'Une annonce vendue ne peut etre modifiee que par un haut grade' });
            }
            res.json({ weapon: existing });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/crafts/myweapons/:id', requireAuth, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const existing = getMyWeaponById(id);
            if (!existing) return res.status(404).json({ error: 'Annonce introuvable' });

            const canManageAny = canValidateCraft(req.session.user) || canDeleteMyWeapons(req.session.user);
            const isOwner = String(existing.user_id) === String(req.session.user.id);
            if (!isOwner && !canManageAny) return res.status(403).json({ error: 'Action non autorisee' });
            if (!canManageAny && existing.is_sold) {
                return res.status(403).json({ error: 'Une annonce vendue ne peut etre modifiee que par un haut grade' });
            }

            const weaponName = String(req.body.weapon_name || '').trim();
            if (!weaponName) return res.status(400).json({ error: "Nom de l'arme requis" });
            const isCrafted = req.body.is_crafted === true || req.body.is_crafted === 1 || req.body.is_crafted === '1' || req.body.is_crafted === 'true';
            const serial = String(req.body.serial_number || '').trim();
            if (serial && serialAlreadyListed(serial, id)) {
                return res.status(409).json({ error: `Le N° de série ${serial} est déjà en vente ou vendu` });
            }
            const parseOptionalAmount = value => {
                const raw = String(value ?? '').trim();
                if (!raw) return null;
                const amount = parseInt(raw, 10);
                return Number.isFinite(amount) && amount >= 0 ? amount : null;
            };
            const askingPrice = parseOptionalAmount(req.body.asking_price);
            const minPrice = parseOptionalAmount(req.body.min_price);
            const priceLimitError = validateMyWeaponPriceLimit({
                isCrafted21BS: isCrafted,
                weaponName,
                weaponId: existing.craft_request_id ? getRequest(existing.craft_request_id)?.weapon_id : null,
                askingPrice,
                minPrice,
            });
            if (priceLimitError) return res.status(400).json({ error: priceLimitError });
            const nextIsSold = req.body.is_sold === true || req.body.is_sold === 1 || req.body.is_sold === '1' || req.body.is_sold === 'true';
            if (nextIsSold && !canManageAny) {
                return res.status(403).json({ error: 'Utilise le bouton Marquer vendu pour declarer une vente' });
            }
            const soldTo = nextIsSold ? String(req.body.sold_to || '').trim() : null;
            const soldPrice = nextIsSold ? parseOptionalAmount(req.body.sold_price) : null;
            let soldAt = null;
            if (nextIsSold) {
                if (!soldTo || soldPrice === null) return res.status(400).json({ error: 'Acheteur et prix vendu requis' });
                const rawSoldAt = String(req.body.sold_at || '').trim();
                soldAt = rawSoldAt
                    ? Math.floor(new Date(`${rawSoldAt}T12:00:00+01:00`).getTime() / 1000)
                    : (existing.sold_at || Math.floor(Date.now() / 1000));
                if (!Number.isFinite(soldAt)) return res.status(400).json({ error: 'Date de vente invalide' });
            }

            let ownerId = existing.user_id;
            let ownerName = existing.user_name;
            let ownerAvatar = existing.user_avatar || null;
            if (canManageAny && req.body.user_id && String(req.body.user_id) !== String(existing.user_id)) {
                ownerId = String(req.body.user_id).trim();
                ownerName = String(req.body.user_name || ownerId).trim();
                ownerAvatar = await getDiscordUserAvatar(ownerId);
            } else if (canManageAny && req.body.user_name) {
                ownerName = String(req.body.user_name).trim() || ownerName;
            }

            const batchId = existing.batch_id || null;
                            if (batchId) {
                    db.prepare(`
                        UPDATE my_weapons
                        SET user_id = ?, user_name = ?, user_avatar = ?, weapon_name = ?, is_crafted = ?,
                            asking_price = ?, min_price = ?
                        WHERE batch_id = ?
                    `).run(ownerId, ownerName, ownerAvatar, weaponName, isCrafted ? 1 : 0, askingPrice, minPrice, batchId);
                }
                db.prepare(`
                    UPDATE my_weapons
                    SET user_id = ?, user_name = ?, user_avatar = ?, weapon_name = ?, is_crafted = ?,
                        serial_number = ?, asking_price = ?, min_price = ?, is_sold = ?,
                        sold_to = ?, sold_price = ?, sold_at = ?
                    WHERE id = ?
                `).run(ownerId, ownerName, ownerAvatar, weaponName, isCrafted ? 1 : 0, serial || null, askingPrice, minPrice, nextIsSold ? 1 : 0, soldTo, soldPrice, soldAt, id);


            const updatedWeapon = getMyWeaponById(id);
            emitRealtime('craft:status', { requestId: updatedWeapon?.craft_request_id || null, myWeaponId: id, status: updatedWeapon?.is_sold ? 'sold' : 'listed', action: 'myweapon-updated' });
            res.json({ success: true, weapon: updatedWeapon });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Marquer comme vendu
    app.patch('/api/crafts/myweapons/:id/sold', requireAuth, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { sold_to, sold_price, sold_by_id, sold_by_name } = req.body;
            const userId = req.session.user.id;

            // Récupérer
            let existing;
                            existing = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);

            if (!existing) return res.status(404).json({ error: 'Introuvable' });
            if (existing.user_id !== userId && !canDeleteRequests(req.session.user)) {
                return res.status(403).json({ error: 'Action non autorisée — seul le vendeur peut marquer comme vendu' });
            }

            const now = Math.floor(Date.now() / 1000);
            const soldTo = String(sold_to || '').trim();
            if (!soldTo) return res.status(400).json({ error: 'Groupe acheteur obligatoire' });
            const rawSoldPrice = String(sold_price ?? '').trim();
            if (!rawSoldPrice) return res.status(400).json({ error: 'Montant vendu obligatoire' });
            const soldPrice = parseInt(rawSoldPrice, 10);
            if (!Number.isFinite(soldPrice) || soldPrice < 0) {
                return res.status(400).json({ error: 'Montant vendu invalide' });
            }
            const soldById = String(sold_by_id || '').trim();
            const soldByName = String(sold_by_name || '').trim();
            if (!soldById) return res.status(400).json({ error: 'Vendeur obligatoire' });

                            db.prepare(`UPDATE my_weapons SET is_sold = 1, sold_to = ?, sold_price = ?, sold_at = ?, sold_by_id = ?, sold_by_name = ? WHERE id = ?`)
                    .run(soldTo, soldPrice, now, soldById, soldByName, id);


            // Mettre à jour le message Discord (édit ou nouveau message)
            try {
                const channel = await fetchDiscordChannel(MYWEAPONS_CHANNEL, 'MYWEAPONS_LISTING');
                if (channel) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`Vente finalisée • ${existing.weapon_name}`)
                        .setDescription('Transaction confirmée. L’annonce est verrouillée.')
                        .setColor(0x4ade80)
                        .addFields(
                            { name: 'Vendeur', value: `<@${existing.user_id}>`, inline: true },
                            { name: 'Acheteur', value: soldTo, inline: true },
                            { name: 'Prix final', value: moneyLabel(soldPrice), inline: true },
                        )
                        .setTimestamp()
                        .setFooter({ text: '21 Block Savage • Vente terminée' });

                    if (existing.discord_message_id) {
                        try {
                            const msg = await channel.messages.fetch(existing.discord_message_id);
                            await msg.edit({
                                content: `✅ Annonce clôturée • **VENDU**`,
                                embeds: [embed]
                            });
                        } catch {
                            await channel.send({
                                content: `✅ Vente finalisée • **${existing.weapon_name}**`,
                                embeds: [embed],
                                allowedMentions: { parse: [] }
                            });
                        }
                    } else {
                        await channel.send({
                            content: `✅ Vente finalisée • **${existing.weapon_name}**`,
                            embeds: [embed],
                            allowedMentions: { parse: [] }
                        });
                    }
                }
            } catch (e) { console.error('Erreur update Discord:', e.message); }

            // Auto-remplir Tableau de craft si l'arme est craftée 21BS et a un N°Série
            try {
                await updateMyWeaponsDiscordBatch(existing);
            } catch (e) { console.error('Erreur update Discord lot myweapons:', e.message); }

            let autoFilledCraft = null;
            let matchedRequestForLog = null;
            if (existing.is_crafted && existing.serial_number) {
                try {
                    let matchedRequest;
                                            // Chercher demande par : user_id + N°Série + status (crafted/in_progress/pending)
                        matchedRequest = db.prepare(`
                            SELECT r.*, w.name as weapon_name FROM craft_requests r
                            JOIN weapons w ON r.weapon_id = w.id
                            WHERE r.user_id = ? AND r.serial_number = ? AND r.status != 'completed'
                            ORDER BY r.created_at DESC LIMIT 1
                        `).get(existing.user_id, existing.serial_number);


                    if (matchedRequest) {
                        matchedRequestForLog = matchedRequest;
                        // Compléter la demande craft avec les infos de vente
                                                    db.prepare(`UPDATE craft_requests SET buyer_org = ?, sale_price = ?, sale_date = ?, completed_by_id = ?, completed_by_name = ?, status = 'completed' WHERE id = ?`)
                                .run(soldTo, soldPrice, now, userId, existing.user_name, matchedRequest.id);

                        autoFilledCraft = { id: matchedRequest.id, weapon_name: matchedRequest.weapon_name };

                    }
                } catch (e) { console.error('Erreur auto-fill craft:', e.message); }
            }

            try {
                const soldWeaponForLog = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);
                const saleLogged = soldWeaponForLog ? await postMyWeaponsSaleLog(soldWeaponForLog) : false;
                if (saleLogged && matchedRequestForLog && !matchedRequestForLog.posted_to_channel) {
                    markRequestPosted(matchedRequestForLog.id);
                }
            } catch (e) {
                console.error('Erreur log vente WEAPONS_LOG:', e.message);
            }

            emitRealtime('craft:status', { requestId: matchedRequestForLog?.id || existing.craft_request_id || null, myWeaponId: id, status: 'sold', action: 'myweapon-sold' });
            res.json({ success: true, autoFilledCraft });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/myweapons/:id', requireAuth, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const userId = req.session.user.id;
            let existing;
                            existing = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);

            if (!existing) return res.status(404).json({ error: 'Introuvable' });
            // Le vendeur peut supprimer sa propre annonce, OU super admin
            if (existing.user_id !== userId && !canDeleteMyWeapons(req.session.user)) {
                return res.status(403).json({ error: 'Action non autorisée' });
            }
            if (existing.discord_message_id) {
                try {
                    const channel = await fetchDiscordChannel(MYWEAPONS_CHANNEL, 'MYWEAPONS_LISTING_DELETE');
                    const msg = channel ? await channel.messages.fetch(existing.discord_message_id) : null;
                    if (msg) await msg.delete();
                } catch {}
            }
                            if (existing.batch_id) db.prepare('DELETE FROM my_weapons WHERE batch_id = ?').run(existing.batch_id);
                else db.prepare('DELETE FROM my_weapons WHERE id = ?').run(id);

            emitRealtime('craft:status', { requestId: existing.craft_request_id || null, myWeaponId: id, status: 'deleted', action: 'myweapon-deleted' });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
}

module.exports = { initDB, registerCraftEndpoints };
