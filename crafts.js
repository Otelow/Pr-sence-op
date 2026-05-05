// ==========================================
// MODULE CRAFTS — DB SQLite avec fallback JSON
// ==========================================
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const DATA_DIR = '/data';
const DB_PATH = path.join(DATA_DIR, 'crafts.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'crafts');
const FALLBACK_PATH = path.join(DATA_DIR, 'crafts.json');

// Assurer l'existence des dossiers
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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
    useSQLite = false;
}

let jsonData = {
    weapons: [],
    organizations: [],
    craft_requests: [],
    counters: { weapons: 0, organizations: 0, requests: 0 },
};

function loadJSON() {
    try {
        if (fs.existsSync(FALLBACK_PATH)) {
            jsonData = JSON.parse(fs.readFileSync(FALLBACK_PATH, 'utf8'));
            jsonData.weapons = jsonData.weapons || [];
            jsonData.organizations = jsonData.organizations || [];
            jsonData.craft_requests = jsonData.craft_requests || [];
            jsonData.counters = jsonData.counters || { weapons: 0, organizations: 0, requests: 0 };
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
                    discord_message_id TEXT,
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
                CREATE INDEX IF NOT EXISTS idx_requests_status ON craft_requests(status);
                CREATE INDEX IF NOT EXISTS idx_requests_user ON craft_requests(user_id);
                CREATE INDEX IF NOT EXISTS idx_myweapons_user ON my_weapons(user_id);
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
            try { db.exec(`ALTER TABLE my_weapons ADD COLUMN discord_message_id TEXT`); } catch {}

            const defaultIngredients = ['Tungstène', 'Bloc de tungstène', 'Bloc de chrome', 'Bloc de titane', 'Corps de Pistolet', 'Corps de Fusil à pompe', 'Corps de Mitraillette', 'Corps de Fusil'];
            for (const ing of defaultIngredients) {
                try { db.prepare('INSERT OR IGNORE INTO ingredients (name) VALUES (?)').run(ing); } catch {}
            }

            console.log('💾 DB Crafts initialisée (SQLite)');
        } catch (e) {
            console.error('❌ SQLite init error, fallback JSON:', e.message);
            useSQLite = false;
            loadJSON();
            seedDefaultIngredientsJSON();
            console.log('💾 DB Crafts initialisée (JSON fallback)');
        }
    } else {
        loadJSON();
        seedDefaultIngredientsJSON();
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

function getRequests(status) {
    if (useSQLite) {
        let query = `SELECT r.*, w.name as weapon_name, w.image_path as weapon_image FROM craft_requests r JOIN weapons w ON r.weapon_id = w.id`;
        const params = [];
        if (status && status !== 'all') { query += ' WHERE r.status = ?'; params.push(status); }
        query += ' ORDER BY r.created_at DESC';
        return db.prepare(query).all(...params);
    }
    let arr = jsonData.craft_requests;
    if (status && status !== 'all') arr = arr.filter(r => r.status === status);
    return [...arr].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).map(r => {
        const w = jsonData.weapons.find(w => w.id === r.weapon_id);
        return { ...r, weapon_name: w ? w.name : '?', weapon_image: w ? w.image_path : null };
    });
}

function getRequest(id) {
    if (useSQLite) {
        return db.prepare(`SELECT r.*, w.name as weapon_name FROM craft_requests r JOIN weapons w ON r.weapon_id = w.id WHERE r.id = ?`).get(id);
    }
    const r = jsonData.craft_requests.find(r => r.id === id);
    if (!r) return null;
    const w = jsonData.weapons.find(w => w.id === r.weapon_id);
    return { ...r, weapon_name: w ? w.name : '?' };
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

            // Trier par craft_price DÉCROISSANT
            list.sort((a, b) => (b.craft_price || 0) - (a.craft_price || 0));

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
            const requests = getRequests(req.query.status);
            const list = requests.map(r => ({
                ...r,
                weapon_image_url: r.weapon_image ? `/crafts/images/${r.weapon_image}` : null,
                has_plan: !!r.has_plan, has_money: !!r.has_money, crafted: !!r.crafted,
            }));
            res.json({ requests: list });
        } catch (e) { res.json({ requests: [], error: e.message }); }
    });

    app.post('/api/crafts/requests', requireAuth, (req, res) => {
        try {
            const { weapon_id, has_plan, has_money } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            if (!weapon_id) return res.status(400).json({ error: 'Arme requise' });
            const weapon = getWeapon(weapon_id);
            if (!weapon) return res.status(404).json({ error: 'Arme introuvable' });
            const id = insertRequest(userId, userName, weapon_id, has_plan, has_money);
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // CRAFT_VALIDATION_ROLES : seuls ces rôles peuvent valider/cocher crafté
    const CRAFT_VALIDATION_ROLES = ['1485279148246175764', '1486744891848654988', '1485279534650494976'];
    const SUPER_ADMIN_ROLE = '1485279148246175764';
    const SUPER_ADMIN_USER = '952986899667103804';

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
            if (crafted) {
                // Ping vers le NOUVEAU salon 1496977220097282290
                const channel = botClient.channels.cache.get('1496977220097282290');
                if (channel) {
                    await channel.send({
                        content: `<@${existing.user_id}> ton **${existing.weapon_name}** est craft ! ✅\n📋 N°Série : \`${serial_number || 'N/A'}\`\n💡 Pense à compléter le **prix de vente**, **groupe acheteur** et **date de vente** une fois la transaction effectuée.`,
                        allowedMentions: { users: [existing.user_id] }
                    }).catch(e => console.error('Erreur ping craft:', e.message));
                }
            }
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Changement de statut (En cours / Refusé)
    app.patch('/api/crafts/requests/:id/status', requireAuth, (req, res) => {
        try {
            if (!canValidateCraft(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }
            const id = parseInt(req.params.id);
            const { status } = req.body;
            const allowed = ['pending', 'in_progress', 'rejected'];
            if (!allowed.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

            if (useSQLite) {
                db.prepare('UPDATE craft_requests SET status = ? WHERE id = ?').run(status, id);
            } else {
                const r = jsonData.craft_requests.find(r => r.id === id);
                if (r) { r.status = status; saveJSON(); }
            }
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
                    await channel.send({
                        content: `📋 **Récap craft & vente** par <@${updated.completed_by_id}>\n` +
                                 `• **${updated.weapon_name}** (craft) [${updated.serial_number || 'N/A'}]\n` +
                                 `• Vendu à : **${updated.buyer_org || 'N/A'}**\n` +
                                 `• Prix : **${updated.sale_price ? updated.sale_price.toLocaleString('fr-FR') + '$' : 'N/A'}**\n` +
                                 `• Date vente : **${saleDate}**`,
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
            // Marquer celles qui appartiennent au current user
            list = list.map(w => ({ ...w, is_mine: w.user_id === userId }));
            res.json({ myweapons: list });
        } catch (e) { res.json({ myweapons: [], error: e.message }); }
    });

    app.post('/api/crafts/myweapons', requireAuth, async (req, res) => {
        try {
            const { weapon_name, is_crafted, serial_number, asking_price, min_price } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const userAvatar = req.session.user.avatar || null;
            if (!weapon_name) return res.status(400).json({ error: "Nom de l'arme requis" });

            const askingPrice = parseInt(asking_price) || null;
            const minPrice = parseInt(min_price) || null;

            // Insérer dans la DB
            let id;
            if (useSQLite) {
                const r = db.prepare(`INSERT INTO my_weapons (user_id, user_name, user_avatar, weapon_name, is_crafted, serial_number, asking_price, min_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(userId, userName, userAvatar, weapon_name, is_crafted ? 1 : 0, serial_number || null, askingPrice, minPrice);
                id = r.lastInsertRowid;
            } else {
                if (!jsonData.my_weapons) jsonData.my_weapons = [];
                if (!jsonData.counters.myweapons) jsonData.counters.myweapons = 0;
                jsonData.counters.myweapons++;
                id = jsonData.counters.myweapons;
                jsonData.my_weapons.push({
                    id, user_id: userId, user_name: userName, user_avatar: userAvatar,
                    weapon_name, is_crafted: is_crafted ? 1 : 0,
                    serial_number: serial_number || null,
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
                        .setTitle(`🔫 Arme à vendre : ${weapon_name}`)
                        .setColor(0xff8c00)
                        .addFields(
                            { name: '👤 Vendeur', value: `<@${userId}>`, inline: true },
                            { name: '⚒ Craft 21BS', value: is_crafted ? '✅ Oui' : '❌ Non', inline: true },
                            ...(serial_number ? [{ name: '📋 N°Série', value: `\`${serial_number}\``, inline: true }] : []),
                            { name: '💰 Prix souhaité', value: askingPrice ? `${askingPrice.toLocaleString('fr-FR')}$` : 'Non spécifié', inline: true },
                            { name: '📉 Prix minimum', value: minPrice ? `${minPrice.toLocaleString('fr-FR')}$` : 'Non spécifié', inline: true },
                        )
                        .setTimestamp()
                        .setFooter({ text: '21 Block Savage — Vente d\'armes' });

                    const msg = await channel.send({
                        content: `<@${userId}> a une nouvelle arme à vendre !`,
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
            const { sold_to, sold_price } = req.body;
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

            if (useSQLite) {
                db.prepare(`UPDATE my_weapons SET is_sold = 1, sold_to = ?, sold_price = ?, sold_at = ? WHERE id = ?`)
                    .run(sold_to || null, soldPrice, now, id);
            } else {
                const w = jsonData.my_weapons.find(w => w.id === id);
                if (w) {
                    w.is_sold = 1;
                    w.sold_to = sold_to || null;
                    w.sold_price = soldPrice;
                    w.sold_at = now;
                    saveJSON();
                }
            }

            // Mettre à jour le message Discord (édit ou nouveau message)
            try {
                const channel = botClient.channels.cache.get(MYWEAPONS_CHANNEL);
                if (channel) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`✅ VENDU : ${existing.weapon_name}`)
                        .setColor(0x4ade80)
                        .addFields(
                            { name: '👤 Vendeur', value: `<@${existing.user_id}>`, inline: true },
                            { name: '🏢 Acheteur', value: sold_to || 'N/A', inline: true },
                            { name: '💰 Prix de vente', value: soldPrice ? `${soldPrice.toLocaleString('fr-FR')}$` : 'N/A', inline: true },
                        )
                        .setTimestamp()
                        .setFooter({ text: '21 Block Savage — Vente terminée' });

                    if (existing.discord_message_id) {
                        try {
                            const msg = await channel.messages.fetch(existing.discord_message_id);
                            await msg.edit({
                                content: `~~Annonce initiale~~ — **VENDU** ✅`,
                                embeds: [embed]
                            });
                        } catch {
                            await channel.send({
                                content: `📢 Vente de **${existing.weapon_name}** par <@${existing.user_id}> finalisée`,
                                embeds: [embed],
                                allowedMentions: { parse: [] }
                            });
                        }
                    } else {
                        await channel.send({
                            content: `📢 Vente de **${existing.weapon_name}** par <@${existing.user_id}> finalisée`,
                            embeds: [embed],
                            allowedMentions: { parse: [] }
                        });
                    }
                }
            } catch (e) { console.error('Erreur update Discord:', e.message); }

            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/myweapons/:id', requireAuth, (req, res) => {
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
            if (existing.user_id !== userId && !canDeleteRequests(req.session.user)) {
                return res.status(403).json({ error: 'Action non autorisée' });
            }
            if (useSQLite) {
                db.prepare('DELETE FROM my_weapons WHERE id = ?').run(id);
            } else {
                jsonData.my_weapons = (jsonData.my_weapons || []).filter(w => w.id !== id);
                saveJSON();
            }
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
}

module.exports = { initDB, registerCraftEndpoints };
