// ==========================================
// MODULE CRAFTS — DB SQLite + Endpoints
// ==========================================
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const multer = require('multer');

const DATA_DIR = '/data';
const DB_PATH = path.join(DATA_DIR, 'crafts.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'crafts');

// Assurer l'existence des dossiers
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let db;

function initDB() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    // Catalogue des armes craftables
    db.exec(`
        CREATE TABLE IF NOT EXISTS weapons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            image_path TEXT,
            craft_time INTEGER DEFAULT 0,
            craft_price INTEGER DEFAULT 0,
            ingredients TEXT DEFAULT '[]',
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
            created_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY(weapon_id) REFERENCES weapons(id)
        );

        CREATE INDEX IF NOT EXISTS idx_requests_status ON craft_requests(status);
        CREATE INDEX IF NOT EXISTS idx_requests_user ON craft_requests(user_id);
    `);

    console.log('💾 DB Crafts initialisée');
}

function getDB() {
    if (!db) initDB();
    return db;
}

// Multer storage pour les images d'armes
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeName = `weapon_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
        cb(null, safeName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Format non supporté'));
    }
});

function registerCraftEndpoints(app, requireAuth, requireAdmin, botClient, botState) {

    // Servir les images uploadées
    app.use('/crafts/images', require('express').static(UPLOADS_DIR));

    // ─── CATALOGUE WEAPONS ─────────────────────
    app.get('/api/crafts/weapons', requireAuth, (req, res) => {
        const db = getDB();
        const weapons = db.prepare('SELECT * FROM weapons ORDER BY name ASC').all();
        const list = weapons.map(w => ({
            ...w,
            ingredients: JSON.parse(w.ingredients || '[]'),
            image_url: w.image_path ? `/crafts/images/${w.image_path}` : null,
        }));
        res.json({ weapons: list });
    });

    app.post('/api/crafts/weapons', requireAdmin, upload.single('image'), (req, res) => {
        try {
            const { name, craft_time, craft_price, ingredients } = req.body;
            if (!name) return res.status(400).json({ error: 'Nom requis' });

            const db = getDB();
            const ingredientsJson = ingredients || '[]';
            const imagePath = req.file ? req.file.filename : null;

            const result = db.prepare(`
                INSERT INTO weapons (name, image_path, craft_time, craft_price, ingredients)
                VALUES (?, ?, ?, ?, ?)
            `).run(name, imagePath, parseInt(craft_time) || 0, parseInt(craft_price) || 0, ingredientsJson);

            res.json({ success: true, id: result.lastInsertRowid });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/crafts/weapons/:id', requireAdmin, upload.single('image'), (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { name, craft_time, craft_price, ingredients } = req.body;
            const db = getDB();

            const existing = db.prepare('SELECT * FROM weapons WHERE id = ?').get(id);
            if (!existing) return res.status(404).json({ error: 'Arme introuvable' });

            // Si nouvelle image, supprimer l'ancienne
            if (req.file && existing.image_path) {
                const oldPath = path.join(UPLOADS_DIR, existing.image_path);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }

            db.prepare(`
                UPDATE weapons
                SET name = ?, craft_time = ?, craft_price = ?, ingredients = ?,
                    image_path = COALESCE(?, image_path)
                WHERE id = ?
            `).run(
                name || existing.name,
                parseInt(craft_time) || existing.craft_time,
                parseInt(craft_price) || existing.craft_price,
                ingredients || existing.ingredients,
                req.file ? req.file.filename : null,
                id
            );

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/crafts/weapons/:id', requireAdmin, (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const db = getDB();
            const existing = db.prepare('SELECT * FROM weapons WHERE id = ?').get(id);
            if (existing && existing.image_path) {
                const p = path.join(UPLOADS_DIR, existing.image_path);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            db.prepare('DELETE FROM weapons WHERE id = ?').run(id);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── ORGANISATIONS ─────────────────────────
    app.get('/api/crafts/organizations', requireAuth, (req, res) => {
        const db = getDB();
        const orgs = db.prepare('SELECT * FROM organizations ORDER BY name ASC').all();
        res.json({ organizations: orgs });
    });

    app.post('/api/crafts/organizations', requireAuth, (req, res) => {
        try {
            const { name } = req.body;
            if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });
            const db = getDB();
            const result = db.prepare('INSERT OR IGNORE INTO organizations (name) VALUES (?)').run(name.trim());
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/crafts/organizations/:id', requireAdmin, (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const db = getDB();
            db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── DEMANDES DE CRAFT ─────────────────────
    app.get('/api/crafts/requests', requireAuth, (req, res) => {
        const db = getDB();
        const status = req.query.status; // 'pending', 'in_progress', 'crafted', 'completed', 'all'

        let query = `
            SELECT r.*, w.name as weapon_name, w.image_path as weapon_image
            FROM craft_requests r
            JOIN weapons w ON r.weapon_id = w.id
        `;
        const params = [];

        if (status && status !== 'all') {
            query += ' WHERE r.status = ?';
            params.push(status);
        }

        query += ' ORDER BY r.created_at DESC';

        const requests = db.prepare(query).all(...params);
        const list = requests.map(r => ({
            ...r,
            weapon_image_url: r.weapon_image ? `/crafts/images/${r.weapon_image}` : null,
            has_plan: !!r.has_plan,
            has_money: !!r.has_money,
            crafted: !!r.crafted,
        }));

        res.json({ requests: list });
    });

    app.post('/api/crafts/requests', requireAuth, (req, res) => {
        try {
            const { weapon_id, has_plan, has_money } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;

            if (!weapon_id) return res.status(400).json({ error: 'Arme requise' });

            const db = getDB();
            const weapon = db.prepare('SELECT * FROM weapons WHERE id = ?').get(weapon_id);
            if (!weapon) return res.status(404).json({ error: 'Arme introuvable' });

            const result = db.prepare(`
                INSERT INTO craft_requests (user_id, user_name, weapon_id, has_plan, has_money)
                VALUES (?, ?, ?, ?, ?)
            `).run(userId, userName, weapon_id, has_plan ? 1 : 0, has_money ? 1 : 0);

            res.json({ success: true, id: result.lastInsertRowid });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Mettre à jour une demande (crafté + N°série + date craft) — Hauts gradés
    app.patch('/api/crafts/requests/:id/craft', requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { crafted, serial_number } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;

            const db = getDB();
            const existing = db.prepare(`
                SELECT r.*, w.name as weapon_name FROM craft_requests r
                JOIN weapons w ON r.weapon_id = w.id WHERE r.id = ?
            `).get(id);
            if (!existing) return res.status(404).json({ error: 'Demande introuvable' });

            const now = Math.floor(Date.now() / 1000);
            db.prepare(`
                UPDATE craft_requests
                SET crafted = ?, serial_number = ?, craft_date = ?,
                    crafted_by_id = ?, crafted_by_name = ?,
                    status = CASE WHEN ? = 1 THEN 'crafted' ELSE 'in_progress' END
                WHERE id = ?
            `).run(crafted ? 1 : 0, serial_number || null, crafted ? now : null, userId, userName, crafted ? 1 : 0, id);

            // Si crafté, ping l'utilisateur dans le salon
            if (crafted) {
                const state = botState();
                const channel = botClient.channels.cache.get(state.CONFIG.CHANNELS.WEAPONS_LOG || '1497021044953845791');
                if (channel) {
                    await channel.send({
                        content: `<@${existing.user_id}> ton **${existing.weapon_name}** est craft ! ✅\n📋 N°Série : \`${serial_number || 'N/A'}\`\n💡 Pense à compléter le **prix de vente**, **groupe acheteur** et **date de vente** une fois la transaction effectuée.`,
                        allowedMentions: { users: [existing.user_id] }
                    }).catch(e => console.error('Erreur ping craft:', e.message));
                }
            }

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Mettre à jour la vente — utilisateur d'origine ou admin
    app.patch('/api/crafts/requests/:id/sale', requireAuth, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { buyer_org, sale_price, sale_date } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;

            const db = getDB();
            const existing = db.prepare(`
                SELECT r.*, w.name as weapon_name FROM craft_requests r
                JOIN weapons w ON r.weapon_id = w.id WHERE r.id = ?
            `).get(id);
            if (!existing) return res.status(404).json({ error: 'Demande introuvable' });

            // Seul le demandeur ou un admin peut compléter
            const isAdmin = req.session.user.isAdmin;
            if (existing.user_id !== userId && !isAdmin) {
                return res.status(403).json({ error: 'Action non autorisée' });
            }

            const saleTimestamp = sale_date ? Math.floor(new Date(sale_date).getTime() / 1000) : Math.floor(Date.now() / 1000);

            db.prepare(`
                UPDATE craft_requests
                SET buyer_org = ?, sale_price = ?, sale_date = ?,
                    completed_by_id = ?, completed_by_name = ?,
                    status = 'completed'
                WHERE id = ?
            `).run(buyer_org || null, parseInt(sale_price) || null, saleTimestamp, userId, userName, id);

            // Poster le récap dans le salon WEAPONS_LOG
            const updated = db.prepare(`
                SELECT r.*, w.name as weapon_name FROM craft_requests r
                JOIN weapons w ON r.weapon_id = w.id WHERE r.id = ?
            `).get(id);

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

                    db.prepare('UPDATE craft_requests SET posted_to_channel = 1 WHERE id = ?').run(id);
                }
            }

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/crafts/requests/:id', requireAdmin, (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const db = getDB();
            db.prepare('DELETE FROM craft_requests WHERE id = ?').run(id);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
}

module.exports = { initDB, getDB, registerCraftEndpoints };
