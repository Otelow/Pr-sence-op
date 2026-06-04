// HISTORIQUE PRÉSENCE 19/05/2026 — persistance + 7 jours
// QUICK WINS 2 18/05/2026 — export CSV audit log admin
// NETTOYAGE 18/05/2026 — petits ajustements
// FINAL POST-STAB A 17/05/2026 ? pino backend
// ONGLET HISTORIQUE 16/05/2026 — endpoint audit log paginé
// CHANTIER COMMANDES 15/05/2026 — catalogue commandes admin et publication Discord
// STABILISATION 15/05/2026 — corrections sécurité et persistance
// ==========================================
// MODULE CRAFTS — DB SQLite
// MODIFIÉ CHANTIER 3 — 14/05/2026 — images craft protégées par session
// MODIFIÉ CHANTIER 4 — 14/05/2026 — rôles craft centralisés
// MODIFIÉ CHANTIER 5 — 14/05/2026 — suppression du fallback JSON
// MODIFIÉ CHANTIER 12 — 14/05/2026 — events temps réel craft/dashboard
// MODIFIE CHANTIER 6 - 14/05/2026 - routes craft extraites en modules web
// ==========================================
// STATUT EN COURS 17/05/2026 — colonnes suivi vente en cours
// FINAL POST-STAB D 17/05/2026 — indexes SQL performance crafts
// STABILISATION FINALE v2 16/05/2026 — migrations suivies et audit log admin
// COMMANDES GROUPES 26/05/2026 — module commandes armes organisations
const path = require('path');
const fs = require('fs');
const config = require('./src/shared/config');
const { ensureDataDirs, createConnection, runMigration } = require('./src/shared/database');
const log = require('./src/shared/logger');
const { audit, queryAuditLogs, exportAuditLogs } = require('./src/shared/auditLog');
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
const { createGroupOrderService } = require('./src/web/services/crafts/groupOrders');
const { createStockService } = require('./src/web/services/crafts/stock');
const { registerCraftCatalogRoutes } = require('./src/web/routes/crafts/catalog');
const { registerOrderAdvanceRoutes } = require('./src/web/routes/crafts/orderAdvances');
const { registerCraftRequestRoutes } = require('./src/web/routes/crafts/requests');
const { registerGroupOrderRoutes } = require('./src/web/routes/crafts/groupOrders');
const { registerMyWeaponsRoutes } = require('./src/web/routes/crafts/myWeapons');

const DATA_DIR = config.paths.data;
const DB_PATH = config.paths.database;
const UPLOADS_DIR = config.paths.craftsUploads;
let db = null;
let orderAdvancesBotClient = null;
const upload = createCraftUploadMiddleware(UPLOADS_DIR);

const ORDER_INGREDIENTS_CATALOG = [
    { name: 'Titane', unit_price: 14000 },
    { name: 'Chrome', unit_price: 9300 },
    { name: 'Tungstène', unit_price: 6800 },
];

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

function parseId(v, max = 2_000_000) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

// Ne jamais supprimer les anciennes migrations : schema_migrations garde la trace
// de ce qui a déjà été appliqué sur les DB existantes en prod/Railway.
const MIGRATIONS = [
    { name: '001_weapons_plan_image_path', migrate: db => db.exec('ALTER TABLE weapons ADD COLUMN plan_image_path TEXT') },
    { name: '002_weapons_requires_plan', migrate: db => db.exec('ALTER TABLE weapons ADD COLUMN requires_plan INTEGER DEFAULT 0') },
    { name: '003_weapons_sale_price', migrate: db => db.exec('ALTER TABLE weapons ADD COLUMN sale_price INTEGER DEFAULT 0') },
    { name: '004_weapons_max_sale_price', migrate: db => db.exec('ALTER TABLE weapons ADD COLUMN max_sale_price INTEGER DEFAULT 0') },
    { name: '005_my_weapon_names_sale_price', migrate: db => db.exec('ALTER TABLE my_weapon_names ADD COLUMN sale_price INTEGER DEFAULT 0') },
    { name: '006_my_weapon_names_max_sale_price', migrate: db => db.exec('ALTER TABLE my_weapon_names ADD COLUMN max_sale_price INTEGER DEFAULT 0') },
    { name: '007_my_weapons_user_avatar', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN user_avatar TEXT') },
    { name: '008_my_weapons_asking_price', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN asking_price INTEGER') },
    { name: '009_my_weapons_min_price', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN min_price INTEGER') },
    { name: '010_my_weapons_is_sold', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN is_sold INTEGER DEFAULT 0') },
    { name: '011_my_weapons_sold_to', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN sold_to TEXT') },
    { name: '012_my_weapons_sold_price', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN sold_price INTEGER') },
    { name: '013_my_weapons_sold_at', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN sold_at INTEGER') },
    { name: '014_my_weapons_crafted_by_id', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN crafted_by_id TEXT') },
    { name: '015_my_weapons_crafted_by_name', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN crafted_by_name TEXT') },
    { name: '016_my_weapons_sold_by_id', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN sold_by_id TEXT') },
    { name: '017_my_weapons_sold_by_name', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN sold_by_name TEXT') },
    { name: '018_my_weapons_discord_message_id', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN discord_message_id TEXT') },
    { name: '019_my_weapons_weapons_log_message_id', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN weapons_log_message_id TEXT') },
    { name: '020_my_weapons_sale_discord_message_id', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN sale_discord_message_id TEXT') },
    { name: '021_my_weapons_batch_id', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN batch_id TEXT') },
    { name: '022_my_weapons_created_by_id', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN created_by_id TEXT') },
    { name: '023_my_weapons_created_by_name', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN created_by_name TEXT') },
    { name: '024_my_weapons_craft_request_id', migrate: db => db.exec('ALTER TABLE my_weapons ADD COLUMN craft_request_id INTEGER') },
    { name: '025_craft_requests_discord_message_id', migrate: db => db.exec('ALTER TABLE craft_requests ADD COLUMN discord_message_id TEXT') },
    { name: '026_craft_requests_stock_consumed_at', migrate: db => db.exec('ALTER TABLE craft_requests ADD COLUMN stock_consumed_at INTEGER') },
    { name: '027_craft_requests_request_type', migrate: db => db.exec('ALTER TABLE craft_requests ADD COLUMN request_type TEXT') },
    { name: '028_craft_requests_is_test', migrate: db => db.exec('ALTER TABLE craft_requests ADD COLUMN is_test INTEGER DEFAULT 0') },
    { name: '029_craft_requests_refusal_reason', migrate: db => db.exec('ALTER TABLE craft_requests ADD COLUMN refusal_reason TEXT') },
    { name: '029b_craft_requests_out_of_stock', migrate: db => db.exec('ALTER TABLE craft_requests ADD COLUMN out_of_stock INTEGER DEFAULT 0') },
    { name: '030_order_advances_discord_message_id', migrate: db => db.exec('ALTER TABLE order_advances ADD COLUMN discord_message_id TEXT') },
    { name: '031_order_advances_discord_channel_id', migrate: db => db.exec('ALTER TABLE order_advances ADD COLUMN discord_channel_id TEXT') },
    { name: '032_order_advances_published_at', migrate: db => db.exec('ALTER TABLE order_advances ADD COLUMN published_at INTEGER') },
    { name: '033_myweapons_craft_request_index', migrate: db => db.exec('CREATE INDEX IF NOT EXISTS idx_myweapons_craft_request ON my_weapons(craft_request_id)') },
    { name: '034_create_audit_log', migrate: db => db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at INTEGER NOT NULL,
            user_id TEXT,
            user_name TEXT,
            action TEXT NOT NULL,
            target_type TEXT,
            target_id TEXT,
            details TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    `) },
    { name: '040_perf_indexes', migrate: db => db.exec(`
        CREATE INDEX IF NOT EXISTS idx_craft_requests_status ON craft_requests(status);
        CREATE INDEX IF NOT EXISTS idx_craft_requests_user ON craft_requests(user_id);
        CREATE INDEX IF NOT EXISTS idx_craft_requests_created ON craft_requests(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_my_weapons_sold ON my_weapons(is_sold);
        CREATE INDEX IF NOT EXISTS idx_my_weapons_owner ON my_weapons(user_id);
        CREATE INDEX IF NOT EXISTS idx_my_weapons_created ON my_weapons(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_order_advances_status ON order_advances(status);
        CREATE INDEX IF NOT EXISTS idx_order_advances_created ON order_advances(created_at DESC);
    `) },
    { name: '050_my_weapons_in_progress', migrate: db => db.exec(`
        ALTER TABLE my_weapons ADD COLUMN is_in_progress INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE my_weapons ADD COLUMN in_progress_at INTEGER;
        ALTER TABLE my_weapons ADD COLUMN in_progress_by TEXT;
    `) },
    { name: '051_presence_history', migrate: db => db.exec(`
        CREATE TABLE IF NOT EXISTS presence_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            op_number INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT,
            status TEXT NOT NULL,
            recorded_at INTEGER NOT NULL,
            UNIQUE(date, op_number, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_presence_history_date ON presence_history(date DESC);
        CREATE INDEX IF NOT EXISTS idx_presence_history_user ON presence_history(user_id);
    `) },
    { name: '052_my_weapons_serial_unique_when_clean', migrate: db => {
        const duplicate = db.prepare(`
            SELECT serial_number
            FROM my_weapons
            WHERE serial_number IS NOT NULL AND TRIM(serial_number) != ''
            GROUP BY serial_number
            HAVING COUNT(*) > 1
            LIMIT 1
        `).get();
        if (!duplicate) {
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_my_weapons_serial_unique
                ON my_weapons(serial_number)
                WHERE serial_number IS NOT NULL AND TRIM(serial_number) != '';
            `);
        } else {
            log.warn(`Index unique my_weapons.serial_number ignoré : doublon existant (${duplicate.serial_number})`);
        }
    } },
    { name: '060_group_orders', migrate: db => db.exec(`
        CREATE TABLE IF NOT EXISTS group_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER,
            organization_name TEXT NOT NULL,
            order_date TEXT,
            subtotal_amount INTEGER NOT NULL DEFAULT 0,
            discount_percent REAL NOT NULL DEFAULT 0,
            discount_amount INTEGER NOT NULL DEFAULT 0,
            total_amount INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'open',
            note TEXT,
            created_by_id TEXT,
            created_by_name TEXT,
            updated_by_id TEXT,
            updated_by_name TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS group_order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            weapon_id INTEGER,
            weapon_name TEXT NOT NULL,
            unit_price INTEGER NOT NULL DEFAULT 0,
            quantity INTEGER NOT NULL DEFAULT 0,
            line_total INTEGER NOT NULL DEFAULT 0,
            crafted_quantity INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (order_id) REFERENCES group_orders(id) ON DELETE CASCADE,
            FOREIGN KEY (weapon_id) REFERENCES weapons(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS group_order_crafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            weapon_id INTEGER,
            weapon_name TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0,
            serial_numbers TEXT DEFAULT '[]',
            crafted_by_id TEXT,
            crafted_by_name TEXT,
            craft_date TEXT,
            note TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (order_id) REFERENCES group_orders(id) ON DELETE CASCADE,
            FOREIGN KEY (item_id) REFERENCES group_order_items(id) ON DELETE CASCADE,
            FOREIGN KEY (weapon_id) REFERENCES weapons(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_group_orders_org ON group_orders(organization_id);
        CREATE INDEX IF NOT EXISTS idx_group_orders_status ON group_orders(status);
        CREATE INDEX IF NOT EXISTS idx_group_orders_created ON group_orders(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_group_order_items_order ON group_order_items(order_id);
        CREATE INDEX IF NOT EXISTS idx_group_order_crafts_order ON group_order_crafts(order_id);
        CREATE INDEX IF NOT EXISTS idx_group_order_crafts_item ON group_order_crafts(item_id);
    `) },
];

function markMigrationApplied(name) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)').run(name);
}

function applyMigrations() {
    for (const migration of MIGRATIONS) {
        try {
            const applied = runMigration(db, migration.name, migration.migrate);
            if (applied) log.info(`↳ migration appliquée : ${migration.name}`);
        } catch (e) {
            if (/duplicate column name|already exists/i.test(e.message || '')) {
                markMigrationApplied(migration.name);
                log.info(`↳ migration déjà présente : ${migration.name}`);
            } else {
                log.error({ err: e.message, migration: migration.name }, '❌ Migration échouée');
                throw e;
            }
        }
    }
}

function initDB() {
            try {
            db = createConnection(DB_PATH);
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
                    out_of_stock INTEGER DEFAULT 0,
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
                    is_in_progress INTEGER NOT NULL DEFAULT 0,
                    in_progress_at INTEGER,
                    in_progress_by TEXT,
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
                    discord_message_id TEXT,
                    discord_channel_id TEXT,
                    published_at INTEGER,
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    updated_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE TABLE IF NOT EXISTS order_advance_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    ingredient_name TEXT NOT NULL,
                    unit_price INTEGER NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 0,
                    line_total INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    FOREIGN KEY (order_id) REFERENCES order_advances(id) ON DELETE CASCADE
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
                CREATE TABLE IF NOT EXISTS group_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    organization_id INTEGER,
                    organization_name TEXT NOT NULL,
                    order_date TEXT,
                    subtotal_amount INTEGER NOT NULL DEFAULT 0,
                    discount_percent REAL NOT NULL DEFAULT 0,
                    discount_amount INTEGER NOT NULL DEFAULT 0,
                    total_amount INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'open',
                    note TEXT,
                    created_by_id TEXT,
                    created_by_name TEXT,
                    updated_by_id TEXT,
                    updated_by_name TEXT,
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    updated_at INTEGER DEFAULT (strftime('%s','now')),
                    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
                );
                CREATE TABLE IF NOT EXISTS group_order_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    weapon_id INTEGER,
                    weapon_name TEXT NOT NULL,
                    unit_price INTEGER NOT NULL DEFAULT 0,
                    quantity INTEGER NOT NULL DEFAULT 0,
                    line_total INTEGER NOT NULL DEFAULT 0,
                    crafted_quantity INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    updated_at INTEGER DEFAULT (strftime('%s','now')),
                    FOREIGN KEY (order_id) REFERENCES group_orders(id) ON DELETE CASCADE,
                    FOREIGN KEY (weapon_id) REFERENCES weapons(id) ON DELETE SET NULL
                );
                CREATE TABLE IF NOT EXISTS group_order_crafts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    item_id INTEGER NOT NULL,
                    weapon_id INTEGER,
                    weapon_name TEXT NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 0,
                    serial_numbers TEXT DEFAULT '[]',
                    crafted_by_id TEXT,
                    crafted_by_name TEXT,
                    craft_date TEXT,
                    note TEXT,
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    FOREIGN KEY (order_id) REFERENCES group_orders(id) ON DELETE CASCADE,
                    FOREIGN KEY (item_id) REFERENCES group_order_items(id) ON DELETE CASCADE,
                    FOREIGN KEY (weapon_id) REFERENCES weapons(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_requests_status ON craft_requests(status);
                CREATE INDEX IF NOT EXISTS idx_requests_user ON craft_requests(user_id);
                CREATE INDEX IF NOT EXISTS idx_myweapons_user ON my_weapons(user_id);
                CREATE INDEX IF NOT EXISTS idx_stock_materials_ingredient ON stock_materials(ingredient_id);
                CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_advance_items(order_id);
                CREATE INDEX IF NOT EXISTS idx_order_repayments_order ON order_advance_repayments(order_id);
                CREATE INDEX IF NOT EXISTS idx_group_orders_org ON group_orders(organization_id);
                CREATE INDEX IF NOT EXISTS idx_group_orders_status ON group_orders(status);
                CREATE INDEX IF NOT EXISTS idx_group_orders_created ON group_orders(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_group_order_items_order ON group_order_items(order_id);
                CREATE INDEX IF NOT EXISTS idx_group_order_crafts_order ON group_order_crafts(order_id);
                CREATE INDEX IF NOT EXISTS idx_group_order_crafts_item ON group_order_crafts(item_id);
            `);

            applyMigrations();

            const defaultIngredients = ['Tungstène', 'Bloc de tungstène', 'Bloc de chrome', 'Bloc de titane', 'Corps de Pistolet', 'Corps de Fusil à pompe', 'Corps de Mitraillette', 'Corps de Fusil'];
            for (const ing of defaultIngredients) {
                try { db.prepare('INSERT OR IGNORE INTO ingredients (name) VALUES (?)').run(ing); } catch {}
            }
            for (const ingredient of ORDER_INGREDIENTS_CATALOG) {
                try { db.prepare('INSERT OR IGNORE INTO ingredients (name, image_path) VALUES (?, NULL)').run(ingredient.name); } catch {}
            }
            seedStockMaterials();
            seedMyWeaponNamesFromWeapons();

            log.info('💾 DB Crafts initialisée (SQLite)');
        } catch (e) {
            log.error({ err: e.message }, '❌ SQLite init error, arrêt du module crafts');
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
        log.error('Erreur seed noms armes vente:', e.message);
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
let transitionCraftRequestStatus;
let applyCraftRequestStatusTransition;
let updateRequestSale;
let markRequestPosted;
let getWeaponSaleStateForCraftRequest;
let getLinkedMyWeaponsForRequest;
let serialAlreadyListed;
let getMyWeaponById;
let deleteRequest;
let deleteCraftRequestCleanly;
let getGroupOrderCatalog;
let getGroupOrders;
let getGroupOrder;
let upsertGroupOrder;
let recordGroupOrderCraft;
let cancelGroupOrder;
let deleteGroupOrder;

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
    getOrderAdvanceCatalog,
    publishOrderAdvance,
    refreshOrderDiscordMessage,
} = createOrderAdvanceService({
    getDb: () => db,
    getBotClient: () => orderAdvancesBotClient,
    catalog: ORDER_INGREDIENTS_CATALOG,
});

({
    getGroupOrderCatalog,
    getGroupOrders,
    getGroupOrder,
    upsertGroupOrder,
    recordGroupOrderCraft,
    cancelGroupOrder,
    deleteGroupOrder,
} = createGroupOrderService({
    getDb: () => db,
    getAllOrgs: (...args) => getAllOrgs(...args),
    getAllMyWeaponNamesWithPriceLimits: (...args) => getAllMyWeaponNamesWithPriceLimits(...args),
    getWeaponByName: (...args) => getWeaponByName(...args),
}));

({
    getRequests,
    getRequest,
    normalizeCraftRequestType,
    insertRequest,
    updateRequestCraft,
    transitionCraftRequestStatus,
    applyCraftRequestStatusTransition,
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
    orderAdvancesBotClient = botClient;
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
            log.warn(`[discord] avatar introuvable pour ${cleanUserId}: ${e.message}`);
            return null;
        }
    }

    function markRequestsRejectedForAbsentMember(userId) {
        const reason = 'Membre plus présent sur le Discord';
        const requests = getRequests('all')
            .filter(r => String(r.user_id) === String(userId))
            .filter(r => ABSENT_MEMBER_CHECK_STATUSES.includes(r.status));
        for (const request of requests) {
            transitionCraftRequestStatus(request.id, 'rejected', { reason });
        }
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
                log.warn(`[craft] demandes refusées automatiquement: membre absent ${userId}`);
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
        getOrderAdvanceCatalog,
        publishOrderAdvance,
        refreshOrderDiscordMessage,
    });

    registerGroupOrderRoutes(app, {
        requireAuth,
        canValidateCraft,
        getGroupOrderCatalog,
        getGroupOrders,
        getGroupOrder,
        upsertGroupOrder,
        recordGroupOrderCraft,
        cancelGroupOrder,
        deleteGroupOrder,
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
        transitionCraftRequestStatus,
        invalidateCraftCaches,
        deleteCraftRequestCleanly,
        deleteRequest,
        markRequestPosted,
        serialAlreadyListed,
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
        applyCraftRequestStatusTransition,
        invalidateCraftCaches,
        markRequestPosted,
        emitRealtime,
        moneyLabel,
    });

    app.get('/api/admin/audit-log', requireAdmin, (req, res) => {
        try {
            const result = queryAuditLogs({
                limit: req.query.limit,
                offset: req.query.offset,
                action: req.query.action,
                user_id: req.query.user_id,
                since: req.query.since,
            });
            audit(req.session.user, 'audit.read', {
                target_type: 'audit_log',
                details: {
                    limit: req.query.limit || null,
                    offset: req.query.offset || null,
                    action: req.query.action || null,
                    user_id: req.query.user_id || null,
                    since: req.query.since || null,
                },
            });
            res.json(result);
        } catch (e) {
            log.warn({ err: e.message }, 'audit log lecture échouée');
            res.status(500).json({ error: 'Impossible de lire l’historique admin' });
        }
    });

    function csvCell(value) {
        const text = String(value ?? '');
        if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
        return text;
    }

    app.get('/api/admin/audit-log/export.csv', requireAdmin, (req, res) => {
        try {
            const filters = {
                action: req.query.action || '',
                user_id: req.query.user_id || '',
                since: req.query.since || '',
            };
            const rows = exportAuditLogs({
                limit: 10000,
                action: filters.action,
                user_id: filters.user_id,
                since: filters.since,
            });
            const header = ['Date ISO', 'Date FR', 'Utilisateur', 'User ID', 'Action', 'Type cible', 'ID cible', 'Détails JSON'];
            const csv = [header.map(csvCell).join(',')];
            for (const row of rows) {
                const date = new Date((Number(row.created_at) || 0) * 1000);
                const dateFR = date.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
                csv.push([
                    date.toISOString(),
                    dateFR,
                    row.user_name || '',
                    row.user_id || '',
                    row.action || '',
                    row.target_type || '',
                    row.target_id || '',
                    row.details || '',
                ].map(csvCell).join(','));
            }

            audit(req.session.user, 'audit.export', {
                target_type: 'audit_log',
                details: { rows: rows.length, filters },
            });

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
            res.send(`\ufeff${csv.join('\n')}`);
        } catch (e) {
            log.warn({ err: e.message }, 'audit log export CSV échoué');
            res.status(500).json({ error: 'Impossible d’exporter l’historique admin' });
        }
    });
}

module.exports = { initDB, registerCraftEndpoints };
