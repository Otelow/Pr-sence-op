// ==========================================
// MODULE CRAFTS — DB SQLite avec fallback JSON
// ==========================================
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('./src/shared/config');
const { ensureDataDirs } = require('./src/shared/database');

const DATA_DIR = config.paths.data;
const DB_PATH = config.paths.database;
const UPLOADS_DIR = config.paths.craftsUploads;
const FALLBACK_PATH = path.join(DATA_DIR, 'crafts.json');

// Assurer l'existence des dossiers
try {
    ensureDataDirs();
    console.log(`[storage] data=${DATA_DIR}`);
    console.log(`[storage] crafts uploads=${UPLOADS_DIR}`);
    console.log(`[database] crafts db=${DB_PATH}`);
} catch (e) {
    console.error('❌ Erreur création dossiers data:', e.message);
}

// Tenter de charger better-sqlite3, sinon fallback JSON
let useSQLite = false;
let db = null;
let Database = null;

try {
    Database = require('better-sqlite3');
    useSQLite = true;
    console.log('✅ better-sqlite3 chargé');
} catch (e) {
    console.warn('⚠️ better-sqlite3 indisponible, fallback JSON activé');
    if (config.isProduction) {
        console.error('❌ Production sans SQLite: vérifie better-sqlite3 et le volume Railway /data.');
    }
    useSQLite = false;
}

let jsonData = {
    weapons: [],
    stock_materials: [],
    my_weapon_names: [],
    organizations: [],
    craft_requests: [],
    counters: { weapons: 0, my_weapon_names: 0, organizations: 0, requests: 0 },
};

function loadJSON() {
    try {
        if (fs.existsSync(FALLBACK_PATH)) {
            jsonData = JSON.parse(fs.readFileSync(FALLBACK_PATH, 'utf8'));
            jsonData.weapons = jsonData.weapons || [];
            jsonData.stock_materials = jsonData.stock_materials || [];
            jsonData.my_weapon_names = jsonData.my_weapon_names || [];
            jsonData.organizations = jsonData.organizations || [];
            jsonData.craft_requests = jsonData.craft_requests || [];
            jsonData.counters = jsonData.counters || { weapons: 0, my_weapon_names: 0, organizations: 0, requests: 0 };
        }
    } catch (e) {
        console.error('Erreur chargement crafts.json:', e.message);
    }
}

function saveJSON() {
    try {
        fs.writeFileSync(FALLBACK_PATH, JSON.stringify(jsonData, null, 2));
    } catch (e) {
        console.error('Erreur sauvegarde crafts.json:', e.message);
    }
}

function nextId(type) {
    jsonData.counters[type] = (jsonData.counters[type] || 0) + 1;
    return jsonData.counters[type];
}

const STOCK_MATERIAL_NAMES = [
    'Bloc de chrome',
    'Bloc de titane',
    'Bloc de tungstène',
    'Chrome',
    'Titane',
    'Tungstène',
];

const CRAFT_PRODUCTION_STATUSES = ['materials', 'waiting_materials', 'in_progress', 'crafted'];
const CRAFT_STOCK_RESERVED_STATUSES = ['materials', 'waiting_materials', 'in_progress'];

function normalizeStockName(value) {
    return String(value || '')
        .replace(/Ã¨/g, 'e')
        .replace(/Ã©/g, 'e')
        .replace(/Ãª/g, 'e')
        .replace(/Ã«/g, 'e')
        .replace(/Ã /g, 'a')
        .replace(/Ã¢/g, 'a')
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

function parseWeaponIngredients(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function initDB() {
    if (useSQLite) {
        try {
            db = new Database(DB_PATH);
            db.pragma('journal_mode = WAL');
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
                    status TEXT DEFAULT 'pending',
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
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE TABLE IF NOT EXISTS my_weapons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL,
                    user_avatar TEXT,
                    weapon_name TEXT NOT NULL,
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
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE INDEX IF NOT EXISTS idx_requests_status ON craft_requests(status);
                CREATE INDEX IF NOT EXISTS idx_requests_user ON craft_requests(user_id);
                CREATE INDEX IF NOT EXISTS idx_myweapons_user ON my_weapons(user_id);
                CREATE INDEX IF NOT EXISTS idx_stock_materials_ingredient ON stock_materials(ingredient_id);
            `);

            // Migrations
            try { db.exec(`ALTER TABLE weapons ADD COLUMN plan_image_path TEXT`); } catch {}
            try { db.exec(`ALTER TABLE weapons ADD COLUMN requires_plan INTEGER DEFAULT 0`); } catch {}
            try { db.exec(`ALTER TABLE weapons ADD COLUMN sale_price INTEGER DEFAULT 0`); } catch {}
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
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN batch_id TEXT`); } catch {}
            try { db.exec(`ALTER TABLE craft_requests ADD COLUMN discord_message_id TEXT`); } catch {}

            const defaultIngredients = ['Tungstène', 'Bloc de tungstène', 'Bloc de chrome', 'Bloc de titane', 'Corps de Pistolet', 'Corps de Fusil à pompe', 'Corps de Mitraillette', 'Corps de Fusil'];
            for (const ing of defaultIngredients) {
                try { db.prepare('INSERT OR IGNORE INTO ingredients (name) VALUES (?)').run(ing); } catch {}
            }
            seedStockMaterials();
            seedMyWeaponNamesFromWeapons();

            console.log('💾 DB Crafts initialisée (SQLite)');
        } catch (e) {
            console.error('❌ SQLite init error, fallback JSON:', e.message);
            useSQLite = false;
            loadJSON();
            seedDefaultIngredientsJSON();
            seedStockMaterials();
            seedMyWeaponNamesFromWeapons();
            console.log('💾 DB Crafts initialisée (JSON fallback)');
        }
    } else {
        loadJSON();
        seedDefaultIngredientsJSON();
        seedStockMaterials();
        seedMyWeaponNamesFromWeapons();
        console.log('💾 DB Crafts initialisée (JSON)');
    }
}

function seedDefaultIngredientsJSON() {
    const defaults = ['Tungstène', 'Bloc de tungstène', 'Bloc de chrome', 'Bloc de titane', 'Corps de Pistolet', 'Corps de Fusil à pompe', 'Corps de Mitraillette', 'Corps de Fusil'];
    if (!jsonData.ingredients) jsonData.ingredients = [];
    if (!jsonData.counters.ingredients) jsonData.counters.ingredients = 0;
    for (const name of defaults) {
        if (!jsonData.ingredients.find(i => i.name === name)) {
            jsonData.counters.ingredients++;
            jsonData.ingredients.push({
                id: jsonData.counters.ingredients,
                name,
                image_path: null,
                created_at: Math.floor(Date.now() / 1000),
            });
        }
    }
    saveJSON();
}

function seedStockMaterials() {
    if (useSQLite) {
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
        return;
    }

    if (!jsonData.ingredients) jsonData.ingredients = [];
    if (!jsonData.stock_materials) jsonData.stock_materials = [];
    if (!jsonData.counters.ingredients) jsonData.counters.ingredients = 0;

    for (const name of STOCK_MATERIAL_NAMES) {
        const matches = jsonData.ingredients.filter(item => normalizeStockName(item.name) === normalizeStockName(name));
        let ingredient = matches.find(item => item.image_path)
            || matches.find(item => item.name === name)
            || matches[0];
        if (!ingredient) {
            jsonData.counters.ingredients++;
            ingredient = {
                id: jsonData.counters.ingredients,
                name,
                image_path: null,
                created_at: Math.floor(Date.now() / 1000),
            };
            jsonData.ingredients.push(ingredient);
        } else if (ingredient.name !== name) {
            ingredient.name = name;
        }

        const duplicateIds = new Set(matches.map(item => Number(item.id)).filter(id => id !== Number(ingredient.id)));
        const duplicateRows = jsonData.stock_materials.filter(row => duplicateIds.has(Number(row.ingredient_id)));
        const existing = jsonData.stock_materials.find(row => Number(row.ingredient_id) === Number(ingredient.id));
        const quantity = Math.max(
            Number(existing?.quantity) || 0,
            ...duplicateRows.map(row => Number(row.quantity) || 0)
        );

        if (existing) {
            existing.quantity = quantity;
            existing.updated_at = Math.floor(Date.now() / 1000);
        } else {
            jsonData.stock_materials.push({
                id: jsonData.stock_materials.length + 1,
                ingredient_id: ingredient.id,
                quantity,
                updated_at: Math.floor(Date.now() / 1000),
            });
        }
        jsonData.stock_materials = jsonData.stock_materials.filter(row => !duplicateIds.has(Number(row.ingredient_id)));
    }
    saveJSON();
}

function seedMyWeaponNamesFromWeapons() {
    try {
        if (useSQLite) {
            const existing = db.prepare('SELECT COUNT(*) as count FROM my_weapon_names').get();
            if (existing && existing.count > 0) return;
            const names = db.prepare('SELECT DISTINCT name FROM weapons WHERE name IS NOT NULL AND TRIM(name) != "" ORDER BY name ASC').all();
            const stmt = db.prepare('INSERT OR IGNORE INTO my_weapon_names (name) VALUES (?)');
            for (const row of names) stmt.run(String(row.name || '').trim());
            return;
        }
        jsonData.my_weapon_names = jsonData.my_weapon_names || [];
        if (jsonData.my_weapon_names.length > 0) return;
        jsonData.counters.my_weapon_names = jsonData.counters.my_weapon_names || 0;
        for (const weapon of (jsonData.weapons || [])) {
            const name = String(weapon.name || '').trim();
            if (!name || jsonData.my_weapon_names.some(w => String(w.name || '').toLowerCase() === name.toLowerCase())) continue;
            jsonData.counters.my_weapon_names++;
            jsonData.my_weapon_names.push({
                id: jsonData.counters.my_weapon_names,
                name,
                created_at: Math.floor(Date.now() / 1000),
            });
        }
        saveJSON();
    } catch (e) {
        console.error('Erreur seed noms armes vente:', e.message);
    }
}

function getAllWeapons() {
    if (useSQLite) return db.prepare('SELECT * FROM weapons ORDER BY name ASC').all();
    return [...jsonData.weapons].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function getWeapon(id) {
    if (useSQLite) return db.prepare('SELECT * FROM weapons WHERE id = ?').get(id);
    return jsonData.weapons.find(w => w.id === id);
}

function insertWeapon(name, image_path, plan_image_path, requires_plan, craft_time, craft_price, sale_price, ingredients) {
    if (useSQLite) {
        const r = db.prepare(`INSERT INTO weapons (name, image_path, plan_image_path, requires_plan, craft_time, craft_price, sale_price, ingredients) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(name, image_path, plan_image_path, requires_plan ? 1 : 0, craft_time, craft_price, sale_price, ingredients);
        return r.lastInsertRowid;
    }
    const id = nextId('weapons');
    jsonData.weapons.push({ id, name, image_path, plan_image_path, requires_plan: requires_plan ? 1 : 0, craft_time, craft_price, sale_price, ingredients, created_at: Math.floor(Date.now() / 1000) });
    saveJSON();
    return id;
}

function updateWeapon(id, name, image_path, plan_image_path, requires_plan, craft_time, craft_price, sale_price, ingredients) {
    if (useSQLite) {
        db.prepare(`UPDATE weapons SET name = ?, craft_time = ?, craft_price = ?, sale_price = ?, ingredients = ?, requires_plan = ?, image_path = COALESCE(?, image_path), plan_image_path = COALESCE(?, plan_image_path) WHERE id = ?`)
            .run(name, craft_time, craft_price, sale_price, ingredients, requires_plan ? 1 : 0, image_path, plan_image_path, id);
        return;
    }
    const w = jsonData.weapons.find(w => w.id === id);
    if (w) {
        w.name = name;
        w.craft_time = craft_time;
        w.craft_price = craft_price;
        w.sale_price = sale_price;
        w.ingredients = ingredients;
        w.requires_plan = requires_plan ? 1 : 0;
        if (image_path) w.image_path = image_path;
        if (plan_image_path) w.plan_image_path = plan_image_path;
        saveJSON();
    }
}

function deleteWeapon(id) {
    if (useSQLite) { db.prepare('DELETE FROM weapons WHERE id = ?').run(id); return; }
    jsonData.weapons = jsonData.weapons.filter(w => w.id !== id);
    saveJSON();
}

// ─── INGREDIENTS ───────────────
function getAllIngredients() {
    if (useSQLite) return db.prepare('SELECT * FROM ingredients ORDER BY name ASC').all();
    return [...(jsonData.ingredients || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function getIngredient(id) {
    if (useSQLite) return db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
    return (jsonData.ingredients || []).find(i => i.id === id);
}

function insertIngredient(name, image_path) {
    if (useSQLite) {
        const r = db.prepare('INSERT OR IGNORE INTO ingredients (name, image_path) VALUES (?, ?)').run(name, image_path);
        return r.lastInsertRowid;
    }
    if (!jsonData.ingredients) jsonData.ingredients = [];
    if (!jsonData.counters.ingredients) jsonData.counters.ingredients = 0;
    if (jsonData.ingredients.find(i => i.name === name)) return null;
    jsonData.counters.ingredients++;
    jsonData.ingredients.push({
        id: jsonData.counters.ingredients,
        name, image_path,
        created_at: Math.floor(Date.now() / 1000),
    });
    saveJSON();
    return jsonData.counters.ingredients;
}

function updateIngredient(id, name, image_path) {
    if (useSQLite) {
        db.prepare(`UPDATE ingredients SET name = ?, image_path = COALESCE(?, image_path) WHERE id = ?`).run(name, image_path, id);
        return;
    }
    const ing = (jsonData.ingredients || []).find(i => i.id === id);
    if (ing) {
        if (name) ing.name = name;
        if (image_path) ing.image_path = image_path;
        saveJSON();
    }
}

function deleteIngredient(id) {
    if (useSQLite) { db.prepare('DELETE FROM ingredients WHERE id = ?').run(id); return; }
    jsonData.ingredients = (jsonData.ingredients || []).filter(i => i.id !== id);
    saveJSON();
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
    seedStockMaterials();

    if (useSQLite) {
        const ingredients = db.prepare('SELECT * FROM ingredients').all();
        const rows = db.prepare(`
            SELECT sm.id, sm.ingredient_id, sm.quantity, sm.updated_at, i.name, i.image_path
            FROM stock_materials sm
            JOIN ingredients i ON i.id = sm.ingredient_id
            ORDER BY i.name ASC
        `).all();
        return dedupeStockRows(rows, ingredients);
    }

    const ingredients = jsonData.ingredients || [];
    const rows = (jsonData.stock_materials || [])
        .map(row => {
            const ingredient = ingredients.find(item => Number(item.id) === Number(row.ingredient_id));
            if (!ingredient || !isStockMaterialName(ingredient.name)) return null;
            return {
                ...row,
                name: ingredient.name,
                image_path: ingredient.image_path,
                quantity: Number(row.quantity) || 0,
                image_url: toCraftImageUrl(ingredient.image_path),
            };
        })
        .filter(Boolean);
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

    if (useSQLite) {
        db.prepare(`
            INSERT INTO stock_materials (ingredient_id, quantity, updated_at)
            VALUES (?, ?, strftime('%s','now'))
            ON CONFLICT(ingredient_id) DO UPDATE SET
                quantity = excluded.quantity,
                updated_at = excluded.updated_at
        `).run(cleanIngredientId, cleanQuantity);
        return getStockMaterials();
    }

    jsonData.stock_materials = jsonData.stock_materials || [];
    const existing = jsonData.stock_materials.find(row => Number(row.ingredient_id) === cleanIngredientId);
    if (existing) {
        existing.quantity = cleanQuantity;
        existing.updated_at = Math.floor(Date.now() / 1000);
    } else {
        jsonData.stock_materials.push({
            id: jsonData.stock_materials.length + 1,
            ingredient_id: cleanIngredientId,
            quantity: cleanQuantity,
            updated_at: Math.floor(Date.now() / 1000),
        });
    }
    saveJSON();
    return getStockMaterials();
}

function getCraftableWeapons() {
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

    return {
        stocks: stockMaterials,
        weapons: decoratedWeapons,
    };
}

function getAllMyWeaponNames() {
    if (useSQLite) return db.prepare('SELECT * FROM my_weapon_names ORDER BY name ASC').all();
    return [...(jsonData.my_weapon_names || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function insertMyWeaponName(name) {
    const clean = String(name || '').trim();
    if (!clean) return null;
    if (useSQLite) {
        const r = db.prepare('INSERT OR IGNORE INTO my_weapon_names (name) VALUES (?)').run(clean);
        return r.lastInsertRowid;
    }
    jsonData.my_weapon_names = jsonData.my_weapon_names || [];
    jsonData.counters.my_weapon_names = jsonData.counters.my_weapon_names || 0;
    if (jsonData.my_weapon_names.some(w => String(w.name || '').toLowerCase() === clean.toLowerCase())) return null;
    const id = nextId('my_weapon_names');
    jsonData.my_weapon_names.push({ id, name: clean, created_at: Math.floor(Date.now() / 1000) });
    saveJSON();
    return id;
}

function deleteMyWeaponName(id) {
    if (useSQLite) { db.prepare('DELETE FROM my_weapon_names WHERE id = ?').run(id); return; }
    jsonData.my_weapon_names = (jsonData.my_weapon_names || []).filter(w => w.id !== id);
    saveJSON();
}

function getAllOrgs() {
    if (useSQLite) return db.prepare('SELECT * FROM organizations ORDER BY name ASC').all();
    return [...jsonData.organizations].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function insertOrg(name) {
    if (useSQLite) {
        const r = db.prepare('INSERT OR IGNORE INTO organizations (name) VALUES (?)').run(name);
        return r.lastInsertRowid;
    }
    if (jsonData.organizations.find(o => o.name === name)) return null;
    const id = nextId('organizations');
    jsonData.organizations.push({ id, name, created_at: Math.floor(Date.now() / 1000) });
    saveJSON();
    return id;
}

function deleteOrg(id) {
    if (useSQLite) { db.prepare('DELETE FROM organizations WHERE id = ?').run(id); return; }
    jsonData.organizations = jsonData.organizations.filter(o => o.id !== id);
    saveJSON();
}

function getRequests(status, options = {}) {
    if (useSQLite) {
        let query = `SELECT r.*, w.name as weapon_name, w.image_path as weapon_image, w.craft_price as weapon_craft_price FROM craft_requests r JOIN weapons w ON r.weapon_id = w.id`;
        const params = [];
        if (options.productionOnly) {
            query += ` WHERE r.status IN (${CRAFT_PRODUCTION_STATUSES.map(() => '?').join(',')})`;
            params.push(...CRAFT_PRODUCTION_STATUSES);
        } else if (status && status !== 'all') {
            query += ' WHERE r.status = ?';
            params.push(status);
        }
        query += ' ORDER BY r.created_at DESC';
        return db.prepare(query).all(...params);
    }
    let arr = jsonData.craft_requests;
    if (options.productionOnly) arr = arr.filter(r => CRAFT_PRODUCTION_STATUSES.includes(r.status));
    else if (status && status !== 'all') arr = arr.filter(r => r.status === status);
    return [...arr].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).map(r => {
        const w = jsonData.weapons.find(w => w.id === r.weapon_id);
        return { ...r, weapon_name: w ? w.name : '?', weapon_image: w ? w.image_path : null, weapon_craft_price: w ? w.craft_price : 0 };
    });
}

function getRequest(id) {
    if (useSQLite) {
        return db.prepare(`SELECT r.*, w.name as weapon_name, w.image_path as weapon_image FROM craft_requests r JOIN weapons w ON r.weapon_id = w.id WHERE r.id = ?`).get(id);
    }
    const r = jsonData.craft_requests.find(r => r.id === id);
    if (!r) return null;
    const w = jsonData.weapons.find(w => w.id === r.weapon_id);
    return { ...r, weapon_name: w ? w.name : '?', weapon_image: w ? w.image_path : null };
}

function insertRequest(user_id, user_name, weapon_id, has_plan, has_money) {
    if (useSQLite) {
        const r = db.prepare(`INSERT INTO craft_requests (user_id, user_name, weapon_id, has_plan, has_money) VALUES (?, ?, ?, ?, ?)`)
            .run(user_id, user_name, weapon_id, has_plan ? 1 : 0, has_money ? 1 : 0);
        return r.lastInsertRowid;
    }
    const id = nextId('requests');
    jsonData.craft_requests.push({
        id, user_id, user_name, weapon_id,
        has_plan: has_plan ? 1 : 0, has_money: has_money ? 1 : 0,
        status: 'pending', crafted: 0,
        created_at: Math.floor(Date.now() / 1000),
    });
    saveJSON();
    return id;
}

function updateRequestCraft(id, crafted, serial, userId, userName) {
    const now = Math.floor(Date.now() / 1000);
    if (useSQLite) {
        db.prepare(`UPDATE craft_requests SET crafted = ?, serial_number = ?, craft_date = ?, crafted_by_id = ?, crafted_by_name = ?, status = CASE WHEN ? = 1 THEN 'crafted' ELSE 'in_progress' END WHERE id = ?`)
            .run(crafted ? 1 : 0, serial || null, crafted ? now : null, userId, userName, crafted ? 1 : 0, id);
        return;
    }
    const r = jsonData.craft_requests.find(r => r.id === id);
    if (r) {
        r.crafted = crafted ? 1 : 0;
        r.serial_number = serial || null;
        r.craft_date = crafted ? now : null;
        r.crafted_by_id = userId;
        r.crafted_by_name = userName;
        r.status = crafted ? 'crafted' : 'in_progress';
        saveJSON();
    }
}

function updateRequestSale(id, buyer_org, sale_price, sale_date, userId, userName) {
    if (useSQLite) {
        db.prepare(`UPDATE craft_requests SET buyer_org = ?, sale_price = ?, sale_date = ?, completed_by_id = ?, completed_by_name = ?, status = 'completed' WHERE id = ?`)
            .run(buyer_org || null, sale_price || null, sale_date, userId, userName, id);
        return;
    }
    const r = jsonData.craft_requests.find(r => r.id === id);
    if (r) {
        r.buyer_org = buyer_org;
        r.sale_price = sale_price;
        r.sale_date = sale_date;
        r.completed_by_id = userId;
        r.completed_by_name = userName;
        r.status = 'completed';
        saveJSON();
    }
}

function markRequestPosted(id) {
    if (useSQLite) { db.prepare('UPDATE craft_requests SET posted_to_channel = 1 WHERE id = ?').run(id); return; }
    const r = jsonData.craft_requests.find(r => r.id === id);
    if (r) { r.posted_to_channel = 1; saveJSON(); }
}

function deleteRequest(id) {
    if (useSQLite) { db.prepare('DELETE FROM craft_requests WHERE id = ?').run(id); return; }
    jsonData.craft_requests = jsonData.craft_requests.filter(r => r.id !== id);
    saveJSON();
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
    app.use('/crafts/images', express.static(UPLOADS_DIR));

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
            const { name, craft_time, craft_price, sale_price, ingredients, requires_plan } = req.body;
            if (!name) return res.status(400).json({ error: 'Nom requis' });
            const imagePath = req.files?.image?.[0]?.filename || null;
            const planImagePath = req.files?.plan_image?.[0]?.filename || null;
            const id = insertWeapon(
                name, imagePath, planImagePath,
                requires_plan === '1' || requires_plan === 'true' || requires_plan === true,
                parseInt(craft_time) || 0,
                parseInt(craft_price) || 0,
                parseInt(sale_price) || 0,
                ingredients || '[]'
            );
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/crafts/weapons/:id', requireAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'plan_image', maxCount: 1 }]), (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { name, craft_time, craft_price, sale_price, ingredients, requires_plan } = req.body;
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
        try { res.json({ names: getAllMyWeaponNames() }); }
        catch (e) { res.json({ names: [], error: e.message }); }
    });

    app.post('/api/crafts/myweapon-names', requireAdmin, (req, res) => {
        try {
            const { name } = req.body;
            if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nom requis' });
            const id = insertMyWeaponName(name);
            res.json({ success: true, id });
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

    app.get('/api/crafts/requests', requireAuth, (req, res) => {
        try {
            const requests = getRequests(req.query.status, {
                productionOnly: req.query.view === 'board',
            });
            const list = requests.map(r => ({
                ...r,
                weapon_image_url: r.weapon_image ? `/crafts/images/${r.weapon_image}` : null,
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

            const channel = botClient.channels.cache.get(CRAFT_REQUEST_CHANNEL);
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

            if (useSQLite) {
                db.prepare('UPDATE craft_requests SET discord_message_id = ? WHERE id = ?').run(msg.id, requestId);
            } else {
                const r = jsonData.craft_requests.find(r => r.id === requestId);
                if (r) { r.discord_message_id = msg.id; saveJSON(); }
            }
        } catch (e) {
            console.error('Erreur postOrUpdateCraftRequestMessage:', e.message);
        }
    }
    // Helper : message de notification de changement de statut dans CRAFT_STATUS_CHANNEL
    async function postCraftStatusUpdate(requestId, newStatus) {
        try {
            const fullReq = getRequest(requestId);
            if (!fullReq) return;
            const channel = botClient.channels.cache.get(CRAFT_STATUS_CHANNEL);
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
            const { weapon_id, has_plan, has_money } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            if (!weapon_id) return res.status(400).json({ error: 'Arme requise' });
            const weapon = getWeapon(weapon_id);
            if (!weapon) return res.status(404).json({ error: 'Arme introuvable' });
            const id = insertRequest(userId, userName, weapon_id, has_plan, has_money);

            // Message Discord
            await postOrUpdateCraftRequestMessage(id);

            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // CRAFT_VALIDATION_ROLES : seuls ces rôles peuvent valider/cocher crafté
    const CRAFT_VALIDATION_ROLES = ['1485279148246175764', '1486744891848654988', '1485279534650494976'];
    const SUPER_ADMIN_ROLE = '1485279148246175764';
    const SUPER_ADMIN_USER = '952986899667103804';
    const MY_WEAPONS_DELETE_ROLE = '1490361524408291459';

    function canValidateCraft(user) {
        if (!user) return false;
        if (user.id === SUPER_ADMIN_USER) return true;
        const userRoles = user.roles || [];
        return CRAFT_VALIDATION_ROLES.some(r => userRoles.includes(r));
    }

    function canDeleteRequests(user) {
        if (!user) return false;
        if (user.id === SUPER_ADMIN_USER) return true;
        return (user.roles || []).includes(SUPER_ADMIN_ROLE);
    }

    function canDeleteMyWeapons(user) {
        if (!user) return false;
        if (user.id === SUPER_ADMIN_USER) return true;
        const roles = user.roles || [];
        return roles.includes(MY_WEAPONS_DELETE_ROLE) || canDeleteRequests(user);
    }

    async function postManualCraftSaleJustification(requestId, saleTimestamp) {
        const updated = getRequest(requestId);
        if (!updated || updated.posted_to_channel) return;

        const state = botState();
        const channelId = (state?.CONFIG?.CHANNELS?.WEAPONS_LOG) || '1497021044953845791';
        const channel = botClient.channels.cache.get(channelId);
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
            )
            .setTimestamp()
            .setFooter({ text: '21 Block Savage • Justification d’arme' });

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

            if (useSQLite) {
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
            } else {
                if (!jsonData.craft_requests) jsonData.craft_requests = [];
                if (!jsonData.counters.requests) jsonData.counters.requests = 0;
                jsonData.counters.requests++;
                requestId = jsonData.counters.requests;
                jsonData.craft_requests.push({
                    id: requestId,
                    user_id: userId,
                    user_name: userName,
                    weapon_id: weapon.id,
                    has_plan: 1,
                    has_money: 1,
                    status,
                    crafted: 1,
                    serial_number: serial,
                    craft_date: craftTimestamp,
                    crafted_by_id: authorizedCrafter.id,
                    crafted_by_name: authorizedCrafter.name,
                    buyer_org: sold ? buyer_org : null,
                    sale_price: soldPrice,
                    sale_date: sold ? saleTimestamp : null,
                    completed_by_id: sold ? soldById : null,
                    completed_by_name: sold ? soldByName : null,
                    posted_to_channel: 0,
                    created_at: now,
                });

                if (!jsonData.my_weapons) jsonData.my_weapons = [];
                if (!jsonData.counters.myweapons) jsonData.counters.myweapons = 0;
                jsonData.counters.myweapons++;
                myWeaponId = jsonData.counters.myweapons;
                jsonData.my_weapons.push({
                    id: myWeaponId,
                    user_id: userId,
                    user_name: userName,
                    user_avatar: userAvatar,
                    weapon_name: weapon.name,
                    is_crafted: 1,
                    serial_number: serial,
                    asking_price: soldPrice,
                    min_price: null,
                    is_sold: sold ? 1 : 0,
                    sold_to: sold ? buyer_org : null,
                    sold_price: soldPrice,
                    sold_at: sold ? saleTimestamp : null,
                    crafted_by_id: authorizedCrafter.id,
                    crafted_by_name: authorizedCrafter.name,
                    sold_by_id: sold ? soldById : null,
                    sold_by_name: sold ? soldByName : null,
                    created_at: now,
                });
                saveJSON();
            }

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
            await postOrUpdateCraftRequestMessage(id);

            if (crafted) {
                const channel = botClient.channels.cache.get(CRAFT_STATUS_CHANNEL);
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

                    await channel.send({
                        content: `✅ <@${existing.user_id}> ton arme est prête : **${existing.weapon_name}**.`,
                        embeds: [embed],
                        allowedMentions: { users: [existing.user_id] },
                    }).catch(e => console.error('Erreur notification craft terminé:', e.message));
                }
            }
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
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

            if (useSQLite) {
                db.prepare('UPDATE craft_requests SET status = ? WHERE id = ?').run(status, id);
            } else {
                const r = jsonData.craft_requests.find(r => r.id === id);
                if (r) { r.status = status; saveJSON(); }
            }

            // Mettre à jour le message Discord original (édition embed)
            await postOrUpdateCraftRequestMessage(id);

            // Notification dans le salon de statut
            await postCraftStatusUpdate(id, status);

            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.patch('/api/crafts/requests/:id/sale', requireAuth, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { buyer_org, sale_price, sale_date } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const existing = getRequest(id);
            if (!existing) return res.status(404).json({ error: 'Demande introuvable' });
            const isAdmin = req.session.user.isAdmin;
            if (existing.user_id !== userId && !isAdmin) return res.status(403).json({ error: 'Action non autorisée' });
            const saleTimestamp = sale_date ? Math.floor(new Date(sale_date).getTime() / 1000) : Math.floor(Date.now() / 1000);
            updateRequestSale(id, buyer_org, parseInt(sale_price) || null, saleTimestamp, userId, userName);
            const updated = getRequest(id);
            if (!existing.posted_to_channel) {
                const state = botState();
                const channel = botClient.channels.cache.get(state.CONFIG.CHANNELS.WEAPONS_LOG || '1497021044953845791');
                if (channel) {
                    const saleDate = updated.sale_date ? new Date(updated.sale_date * 1000).toLocaleDateString('fr-FR') : 'N/A';
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`Justification de vente • ${updated.weapon_name}`)
                        .setColor(0xffb84d)
                        .addFields(
                            { name: 'Gestionnaire', value: `<@${updated.completed_by_id}>`, inline: true },
                            { name: 'Numéro de série', value: `\`${updated.serial_number || 'N/A'}\``, inline: true },
                            { name: 'Acheteur', value: updated.buyer_org || 'N/A', inline: true },
                            { name: 'Prix final', value: moneyLabel(updated.sale_price), inline: true },
                            { name: 'Date vente', value: saleDate, inline: true },
                        )
                        .setTimestamp()
                        .setFooter({ text: '21 Block Savage • Vente craft clôturée' });
                    await channel.send({
                        content: `✅ Vente craft clôturée • **${updated.weapon_name}**`,
                        embeds: [embed],
                        allowedMentions: { parse: [] }
                    }).catch(e => console.error('Erreur récap:', e.message));
                    markRequestPosted(id);
                }
            }
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Annuler/supprimer sa propre demande (pour le demandeur uniquement, ou super admin)
    app.delete('/api/crafts/requests/:id/cancel', requireAuth, (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const userId = req.session.user.id;
            const existing = getRequest(id);
            if (!existing) return res.status(404).json({ error: 'Demande introuvable' });

            // Le demandeur peut annuler tant que c'est pas crafté/finalisé
            const isOwner = existing.user_id === userId;
            const isSuperAdmin = canDeleteRequests(req.session.user);

            if (!isOwner && !isSuperAdmin) {
                return res.status(403).json({ error: 'Tu peux annuler uniquement tes propres demandes' });
            }
            if (isOwner && !isSuperAdmin && (existing.status === 'crafted' || existing.status === 'completed')) {
                return res.status(403).json({ error: 'Demande déjà craftée, contacte un admin' });
            }

            deleteRequest(id);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/requests/:id', requireAuth, (req, res) => {
        try {
            if (!canDeleteRequests(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée à Otelow / Super Admin' });
            }
            deleteRequest(parseInt(req.params.id));
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── MY WEAPONS ─────────────────────
    const MYWEAPONS_CHANNEL = '1497185767053594695';
    const MYWEAPONS_AUTHORIZED_CRAFTERS = [
        { id: 'otelow', name: 'Otelow' },
        { id: 'ney', name: 'Ney' },
        { id: 'le-h', name: 'Le H' },
    ];

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
        if (useSQLite) {
            rows = existing.batch_id
                ? db.prepare('SELECT * FROM my_weapons WHERE batch_id = ? ORDER BY id ASC').all(existing.batch_id)
                : [db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(existing.id)];
        } else {
            rows = (jsonData.my_weapons || []).filter(w => existing.batch_id ? w.batch_id === existing.batch_id : w.id === existing.id);
        }
        rows = rows.filter(Boolean);
        if (!rows.length) return;

        const base = rows[0];
        const available = rows.filter(w => !w.is_sold).length;
        const channel = botClient.channels.cache.get(MYWEAPONS_CHANNEL);
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
        if (useSQLite) {
            if (base.batch_id) db.prepare('UPDATE my_weapons SET discord_message_id = ? WHERE batch_id = ?').run(msg.id, base.batch_id);
            else db.prepare('UPDATE my_weapons SET discord_message_id = ? WHERE id = ?').run(msg.id, base.id);
        } else {
            for (const w of rows) w.discord_message_id = msg.id;
            saveJSON();
        }
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

    function buildMyWeaponsCraftLogEmbed(base, rows) {
        const { EmbedBuilder } = require('discord.js');
        const serials = rows
            .map(w => `\`${w.serial_number}\``)
            .join('\n')
            .slice(0, 1000);
        const date = new Date().toLocaleDateString('fr-FR');

        return new EmbedBuilder()
            .setTitle(`Log arme 21BS • ${base.weapon_name}`)
            .setDescription('Arme craftée par les 21 Block Savage déclarée dans Vos Armes.')
            .setColor(0xffb84d)
            .addFields(
                { name: 'Arme', value: base.weapon_name || 'N/A', inline: true },
                { name: 'Quantité', value: String(rows.length), inline: true },
                { name: 'Membre', value: base.user_id ? `<@${base.user_id}>` : (base.user_name || 'N/A'), inline: true },
                { name: 'Craftée par', value: base.crafted_by_name || 'Non renseigné', inline: true },
                { name: 'Prix souhaité', value: moneyLabel(base.asking_price), inline: true },
                { name: 'Prix minimum', value: moneyLabel(base.min_price), inline: true },
                { name: 'Numéro de série', value: serials || 'N/A', inline: false },
                { name: 'Date', value: date, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: '21 Block Savage • Logs armes' });
    }

    async function postMyWeaponsCraftLog(existing) {
        let rows;
        if (useSQLite) {
            rows = existing.batch_id
                ? db.prepare('SELECT * FROM my_weapons WHERE batch_id = ? ORDER BY id ASC').all(existing.batch_id)
                : [db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(existing.id)];
        } else {
            rows = (jsonData.my_weapons || []).filter(w => existing.batch_id ? w.batch_id === existing.batch_id : w.id === existing.id);
        }

        rows = rows
            .filter(Boolean)
            .filter(w => {
                const crafted = w.is_crafted === true || w.is_crafted === 1 || w.is_crafted === '1';
                return crafted && String(w.serial_number || '').trim();
            });

        if (!rows.length) return;
        if (rows.every(w => w.weapons_log_message_id)) return;

        const existingLogId = rows.find(w => w.weapons_log_message_id)?.weapons_log_message_id;
        if (existingLogId) {
            if (useSQLite) {
                const ids = rows.filter(w => !w.weapons_log_message_id).map(w => w.id);
                const stmt = db.prepare('UPDATE my_weapons SET weapons_log_message_id = ? WHERE id = ?');
                for (const rowId of ids) stmt.run(existingLogId, rowId);
            } else {
                for (const w of rows) {
                    if (!w.weapons_log_message_id) w.weapons_log_message_id = existingLogId;
                }
                saveJSON();
            }
            return;
        }

        const channelId = getWeaponsLogChannelId();
        const channel = await fetchDiscordChannel(channelId, 'WEAPONS_LOG');
        if (!channel) return;

        const base = rows[0];
        const embed = buildMyWeaponsCraftLogEmbed(base, rows);
        try {
            const msg = await channel.send({
                content: `📋 Log arme 21BS • **${base.weapon_name}** • ${rows.length} série(s) enregistrée(s).`,
                embeds: [embed],
                allowedMentions: { parse: [] },
            });
            if (useSQLite) {
                const stmt = db.prepare('UPDATE my_weapons SET weapons_log_message_id = ? WHERE id = ?');
                for (const row of rows) stmt.run(msg.id, row.id);
            } else {
                for (const w of rows) w.weapons_log_message_id = msg.id;
                saveJSON();
            }
        } catch (e) {
            console.error(`[discord] WEAPONS_LOG: envoi impossible pour ${base.weapon_name}: ${e.message}`);
        }
    }

    app.get('/api/crafts/myweapons', requireAuth, (req, res) => {
        try {
            const userId = req.session.user.id;
            // Tout le monde voit toutes les armes en vente, mais on note l'auteur
            let list;
            if (useSQLite) {
                list = db.prepare('SELECT * FROM my_weapons ORDER BY is_sold ASC, created_at DESC').all();
            } else {
                const arr = jsonData.my_weapons || [];
                list = [...arr].sort((a, b) => {
                    if ((a.is_sold || 0) !== (b.is_sold || 0)) return (a.is_sold || 0) - (b.is_sold || 0);
                    return (b.created_at || 0) - (a.created_at || 0);
                });
            }
            res.json({ myweapons: aggregateMyWeapons(list, userId) });
        } catch (e) { res.json({ myweapons: [], error: e.message }); }
    });

    app.post('/api/crafts/myweapons', requireAuth, async (req, res, next) => {
        try {
            const { weapon_name, is_crafted, serial_number, serial_numbers, quantity, asking_price, min_price, crafted_by_id, crafted_by_name } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const userAvatar = req.session.user.avatar || null;
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
            const authorizedCrafter = isCrafted21BS ? resolveAuthorizedCrafter(crafted_by_id, crafted_by_name) : null;
            if (isCrafted21BS && !authorizedCrafter) {
                return res.status(400).json({ error: "Armurier autorisé obligatoire : Otelow, Ney ou Le H" });
            }

            let serials = normalizeSerialList(serial_numbers || serial_number);
            const requestedQuantity = Math.min(50, Math.max(1, parseInt(quantity, 10) || serials.length || 1));
            if (isCrafted21BS && serials.length !== requestedQuantity) {
                return res.status(400).json({ error: `Renseigne ${requestedQuantity} N° de série distinct${requestedQuantity > 1 ? 's' : ''}` });
            }
            if (!isCrafted21BS && serials.length < requestedQuantity) {
                serials = [...serials, ...Array(requestedQuantity - serials.length).fill(null)];
            }

            const askingPrice = parseInt(asking_price) || null;
            const minPrice = parseInt(min_price) || null;
            const craftedById = isCrafted21BS ? authorizedCrafter.id : null;
            const craftedByName = isCrafted21BS ? authorizedCrafter.name : null;
            const batchId = `mw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            let id;

            if (useSQLite) {
                const stmt = db.prepare(`INSERT INTO my_weapons (user_id, user_name, user_avatar, weapon_name, is_crafted, serial_number, asking_price, min_price, batch_id, crafted_by_id, crafted_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                for (const serial of serials) {
                    const r = stmt.run(userId, userName, userAvatar, weaponName, isCrafted21BS ? 1 : 0, serial, askingPrice, minPrice, batchId, craftedById, craftedByName);
                    if (!id) id = r.lastInsertRowid;
                }
            } else {
                if (!jsonData.my_weapons) jsonData.my_weapons = [];
                if (!jsonData.counters.myweapons) jsonData.counters.myweapons = 0;
                const createdAt = Math.floor(Date.now() / 1000);
                for (const serial of serials) {
                    jsonData.counters.myweapons++;
                    const rowId = jsonData.counters.myweapons;
                    if (!id) id = rowId;
                    jsonData.my_weapons.push({
                        id: rowId,
                        user_id: userId,
                        user_name: userName,
                        user_avatar: userAvatar,
                        weapon_name: weaponName,
                        is_crafted: isCrafted21BS ? 1 : 0,
                        serial_number: serial,
                        asking_price: askingPrice,
                        min_price: minPrice,
                        is_sold: 0,
                        batch_id: batchId,
                        crafted_by_id: craftedById,
                        crafted_by_name: craftedByName,
                        created_at: createdAt,
                    });
                }
                saveJSON();
            }

            try {
                const first = useSQLite ? db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id) : (jsonData.my_weapons || []).find(w => w.id === id);
                if (first) {
                    await postMyWeaponsCraftLog(first);
                    await updateMyWeaponsDiscordBatch(first);
                }
            } catch (e) { console.error('Erreur post Discord myweapons:', e.message); }

            return res.json({ success: true, id, quantity: serials.length });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/crafts/myweapons-legacy', requireAuth, async (req, res) => {
        try {
            const { weapon_name, is_crafted, serial_number, asking_price, min_price } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const userAvatar = req.session.user.avatar || null;
            if (!weapon_name) return res.status(400).json({ error: "Nom de l'arme requis" });
            if (!serial_number || !String(serial_number).trim()) return res.status(400).json({ error: 'N° de série obligatoire' });

            const serial = String(serial_number).trim();
            const askingPrice = parseInt(asking_price) || null;
            const minPrice = parseInt(min_price) || null;

            // Insérer dans la DB
            let id;
            if (useSQLite) {
                const r = db.prepare(`INSERT INTO my_weapons (user_id, user_name, user_avatar, weapon_name, is_crafted, serial_number, asking_price, min_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(userId, userName, userAvatar, weapon_name, is_crafted ? 1 : 0, serial, askingPrice, minPrice);
                id = r.lastInsertRowid;
            } else {
                if (!jsonData.my_weapons) jsonData.my_weapons = [];
                if (!jsonData.counters.myweapons) jsonData.counters.myweapons = 0;
                jsonData.counters.myweapons++;
                id = jsonData.counters.myweapons;
                jsonData.my_weapons.push({
                    id, user_id: userId, user_name: userName, user_avatar: userAvatar,
                    weapon_name, is_crafted: is_crafted ? 1 : 0,
                    serial_number: serial,
                    asking_price: askingPrice, min_price: minPrice,
                    is_sold: 0,
                    created_at: Math.floor(Date.now() / 1000),
                });
                saveJSON();
            }

            // Envoyer le résumé sur Discord avec ping
            try {
                const channel = botClient.channels.cache.get(MYWEAPONS_CHANNEL);
                if (channel) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`Marché armurerie • ${weapon_name}`)
                        .setDescription('Nouvelle annonce enregistrée dans le circuit 21BS.')
                        .setColor(0xff8c00)
                        .addFields(
                            { name: 'Vendeur', value: `<@${userId}>`, inline: true },
                            { name: 'Origine', value: is_crafted ? 'Craft 21BS validé' : 'Arme externe', inline: true },
                            { name: 'Numéro de série', value: `\`${serial}\``, inline: true },
                            { name: 'Prix affiché', value: moneyLabel(askingPrice), inline: true },
                            { name: 'Seuil minimum', value: moneyLabel(minPrice), inline: true },
                        )
                        .setTimestamp()
                        .setFooter({ text: '21 Block Savage • Marché armurerie' });

                    const msg = await channel.send({
                        content: `📦 Nouvelle annonce armurerie déposée par <@${userId}>.`,
                        embeds: [embed],
                        allowedMentions: { users: [userId] }
                    });

                    // Stocker l'ID du message pour pouvoir le mettre à jour si vendue
                    if (useSQLite) {
                        db.prepare('UPDATE my_weapons SET discord_message_id = ? WHERE id = ?').run(msg.id, id);
                    } else {
                        const w = jsonData.my_weapons.find(w => w.id === id);
                        if (w) { w.discord_message_id = msg.id; saveJSON(); }
                    }
                }
            } catch (e) { console.error('Erreur post Discord myweapons:', e.message); }

            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Marquer comme vendu
    app.patch('/api/crafts/myweapons/:id/sold', requireAuth, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { sold_to, sold_price, sold_by_id, sold_by_name } = req.body;
            const userId = req.session.user.id;

            // Récupérer
            let existing;
            if (useSQLite) {
                existing = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);
            } else {
                existing = (jsonData.my_weapons || []).find(w => w.id === id);
            }
            if (!existing) return res.status(404).json({ error: 'Introuvable' });
            if (existing.user_id !== userId && !canDeleteRequests(req.session.user)) {
                return res.status(403).json({ error: 'Action non autorisée — seul le vendeur peut marquer comme vendu' });
            }

            const now = Math.floor(Date.now() / 1000);
            const soldPrice = parseInt(sold_price) || null;
            const soldById = String(sold_by_id || '').trim();
            const soldByName = String(sold_by_name || '').trim();
            if (!soldById) return res.status(400).json({ error: 'Vendeur obligatoire' });

            if (useSQLite) {
                db.prepare(`UPDATE my_weapons SET is_sold = 1, sold_to = ?, sold_price = ?, sold_at = ?, sold_by_id = ?, sold_by_name = ? WHERE id = ?`)
                    .run(sold_to || null, soldPrice, now, soldById, soldByName, id);
            } else {
                const w = jsonData.my_weapons.find(w => w.id === id);
                if (w) {
                    w.is_sold = 1;
                    w.sold_to = sold_to || null;
                    w.sold_price = soldPrice;
                    w.sold_at = now;
                    w.sold_by_id = soldById;
                    w.sold_by_name = soldByName;
                    saveJSON();
                }
            }

            // Mettre à jour le message Discord (édit ou nouveau message)
            try {
                const channel = botClient.channels.cache.get(MYWEAPONS_CHANNEL);
                if (channel) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`Vente finalisée • ${existing.weapon_name}`)
                        .setDescription('Transaction confirmée. L’annonce est verrouillée.')
                        .setColor(0x4ade80)
                        .addFields(
                            { name: 'Vendeur', value: `<@${existing.user_id}>`, inline: true },
                            { name: 'Acheteur', value: sold_to || 'N/A', inline: true },
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
            if (existing.is_crafted && existing.serial_number) {
                try {
                    let matchedRequest;
                    if (useSQLite) {
                        // Chercher demande par : user_id + N°Série + status (crafted/in_progress/pending)
                        matchedRequest = db.prepare(`
                            SELECT r.*, w.name as weapon_name FROM craft_requests r
                            JOIN weapons w ON r.weapon_id = w.id
                            WHERE r.user_id = ? AND r.serial_number = ? AND r.status != 'completed'
                            ORDER BY r.created_at DESC LIMIT 1
                        `).get(existing.user_id, existing.serial_number);
                    } else {
                        const req = (jsonData.craft_requests || []).find(r =>
                            r.user_id === existing.user_id &&
                            r.serial_number === existing.serial_number &&
                            r.status !== 'completed'
                        );
                        if (req) {
                            const w = jsonData.weapons.find(w => w.id === req.weapon_id);
                            matchedRequest = { ...req, weapon_name: w ? w.name : '?' };
                        }
                    }

                    if (matchedRequest) {
                        // Compléter la demande craft avec les infos de vente
                        if (useSQLite) {
                            db.prepare(`UPDATE craft_requests SET buyer_org = ?, sale_price = ?, sale_date = ?, completed_by_id = ?, completed_by_name = ?, status = 'completed' WHERE id = ?`)
                                .run(sold_to || null, soldPrice, now, userId, existing.user_name, matchedRequest.id);
                        } else {
                            const r = jsonData.craft_requests.find(r => r.id === matchedRequest.id);
                            if (r) {
                                r.buyer_org = sold_to || null;
                                r.sale_price = soldPrice;
                                r.sale_date = now;
                                r.completed_by_id = userId;
                                r.completed_by_name = existing.user_name;
                                r.status = 'completed';
                                saveJSON();
                            }
                        }
                        autoFilledCraft = { id: matchedRequest.id, weapon_name: matchedRequest.weapon_name };

                        // Posté le récap dans le salon WEAPONS_LOG
                        try {
                            const stateData = botState();
                            const recapChannel = botClient.channels.cache.get((stateData?.CONFIG?.CHANNELS?.WEAPONS_LOG) || '1497021044953845791');
                            if (recapChannel && !matchedRequest.posted_to_channel) {
                                const saleDate = new Date(now * 1000).toLocaleDateString('fr-FR');
                                const { EmbedBuilder } = require('discord.js');
                                const recapEmbed = new EmbedBuilder()
                                    .setTitle(`Justification automatique • ${matchedRequest.weapon_name}`)
                                    .setColor(0xffb84d)
                                    .addFields(
                                        { name: 'Vendeur', value: `<@${existing.user_id}>`, inline: true },
                                        { name: 'Numéro de série', value: `\`${existing.serial_number || 'N/A'}\``, inline: true },
                                        { name: 'Acheteur', value: sold_to || 'N/A', inline: true },
                                        { name: 'Prix final', value: moneyLabel(soldPrice), inline: true },
                                        { name: 'Date vente', value: saleDate, inline: true },
                                    )
                                    .setTimestamp()
                                    .setFooter({ text: '21 Block Savage • Récap craft automatique' });
                                await recapChannel.send({
                                    content: `✅ Dossier craft synchronisé • **${matchedRequest.weapon_name}**`,
                                    embeds: [recapEmbed],
                                    allowedMentions: { parse: [] }
                                });
                                if (useSQLite) {
                                    db.prepare('UPDATE craft_requests SET posted_to_channel = 1 WHERE id = ?').run(matchedRequest.id);
                                } else {
                                    const r = jsonData.craft_requests.find(r => r.id === matchedRequest.id);
                                    if (r) { r.posted_to_channel = 1; saveJSON(); }
                                }
                            }
                        } catch (e) { console.error('Erreur récap auto:', e.message); }
                    }
                } catch (e) { console.error('Erreur auto-fill craft:', e.message); }
            }

            res.json({ success: true, autoFilledCraft });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/myweapons/:id', requireAuth, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const userId = req.session.user.id;
            let existing;
            if (useSQLite) {
                existing = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);
            } else {
                existing = (jsonData.my_weapons || []).find(w => w.id === id);
            }
            if (!existing) return res.status(404).json({ error: 'Introuvable' });
            // Le vendeur peut supprimer sa propre annonce, OU super admin
            if (existing.user_id !== userId && !canDeleteMyWeapons(req.session.user)) {
                return res.status(403).json({ error: 'Action non autorisée' });
            }
            if (existing.discord_message_id) {
                try {
                    const channel = botClient.channels.cache.get(MYWEAPONS_CHANNEL);
                    const msg = channel ? await channel.messages.fetch(existing.discord_message_id) : null;
                    if (msg) await msg.delete();
                } catch {}
            }
            if (useSQLite) {
                if (existing.batch_id) db.prepare('DELETE FROM my_weapons WHERE batch_id = ?').run(existing.batch_id);
                else db.prepare('DELETE FROM my_weapons WHERE id = ?').run(id);
            } else {
                jsonData.my_weapons = (jsonData.my_weapons || []).filter(w => existing.batch_id ? w.batch_id !== existing.batch_id : w.id !== id);
                saveJSON();
            }
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
}

module.exports = { initDB, registerCraftEndpoints };





