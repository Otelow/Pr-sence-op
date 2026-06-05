// FINAL POST-STAB A 17/05/2026 ? pino backend
const log = require('../../../shared/logger');
// STABILISATION 15/05/2026 — corrections sécurité et persistance
// MODIFIE CHANTIER 6 - 14/05/2026 - routes catalogue/stock craft extraites

// AUDIT HOOKS 16/05/2026 — catalogue craft/admin tracé dans audit_log
const { audit } = require('../../../shared/auditLog');
const { safeDeleteUploadedFile } = require('../../services/crafts/uploads');

function parseId(v, max = 2_000_000) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

function parseNonNegativeInteger(value, fallback = null) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
}

function safeParseIngredients(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeIngredientsPayload(value) {
    let parsed;
    try {
        parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value;
    } catch {
        const err = new Error('JSON ingrédients invalide');
        err.statusCode = 400;
        throw err;
    }
    if (!Array.isArray(parsed)) {
        const err = new Error('Les ingrédients doivent être un tableau');
        err.statusCode = 400;
        throw err;
    }
    return parsed.filter(item => {
        const name = String(item?.name || '').trim();
        const ingredientId = item?.ingredient_id === undefined || item?.ingredient_id === null || item?.ingredient_id === ''
            ? null
            : parseId(item.ingredient_id);
        const quantityRaw = item?.quantity ?? item?.amount ?? item?.required;
        const quantityText = quantityRaw === undefined || quantityRaw === null ? '' : String(quantityRaw).trim();
        const quantity = parseNonNegativeInteger(quantityRaw);
        if (!name && ingredientId === null && (!quantityText || quantity === 0)) {
            return false;
        }
        return Boolean(name || ingredientId !== null || quantityText);
    }).map(item => {
        const name = String(item?.name || '').trim();
        const ingredientId = item?.ingredient_id === undefined || item?.ingredient_id === null || item?.ingredient_id === ''
            ? null
            : parseId(item.ingredient_id);
        const quantity = parseNonNegativeInteger(item?.quantity ?? item?.amount ?? item?.required);
        if ((!name && ingredientId === null) || quantity === null || quantity <= 0) {
            const err = new Error('Ingrédient invalide : nom/ID et quantité positive requis');
            err.statusCode = 400;
            throw err;
        }
        return {
            ...item,
            name,
            ingredient_id: ingredientId,
            quantity,
            amount: quantity,
        };
    });
}

function registerCraftCatalogRoutes(app, deps) {
    const {
        fs,
        path,
        upload,
        uploadsDir,
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
    } = deps;

    function safeDeleteUpload(filename) {
        safeDeleteUploadedFile(uploadsDir, filename);
    }

    function uploadedFilesFromReq(req) {
        if (req.file) return [req.file];
        if (Array.isArray(req.files)) return req.files;
        if (req.files && typeof req.files === 'object') return Object.values(req.files).flat();
        return [];
    }

    function cleanupUploadedFiles(req) {
        for (const file of uploadedFilesFromReq(req)) {
            safeDeleteUpload(file.filename || file.path);
        }
    }

    function sendRouteError(res, error) {
        const status = error.statusCode || 500;
        return res.status(status).json({ error: error.message });
    }

    app.get('/api/crafts/stocks', requireAuth, (req, res) => {
        try {
            res.json(getCraftableWeapons());
        } catch (e) {
            log.error('GET stocks:', e);
            res.status(500).json({ stocks: [], weapons: [], error: e.message });
        }
    });

    app.post('/api/admin/stocks/update', requireAdmin, (req, res) => {
        try {
            const updates = Array.isArray(req.body?.materials) ? req.body.materials : [req.body];
            for (const item of updates) {
                updateStockMaterial(item.ingredient_id, item.quantity);
            }
            audit(req.session.user, 'catalog.stock.update', {
                target_type: 'stock',
                details: { updates },
            });
            res.json({ success: true, ...getCraftableWeapons() });
        } catch (e) {
            log.error('POST stocks update:', e);
            res.status(400).json({ success: false, error: e.message });
        }
    });

    app.get('/api/crafts/weapons', requireAuth, (req, res) => {
        try {
            const weapons = getAllWeapons();
            const allIngredients = getAllIngredients();
            const ingrMap = new Map(allIngredients.map(i => [i.name, i]));

            const list = weapons.map(w => {
                let parsedIngredients = safeParseIngredients(w.ingredients);
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
            log.error('GET weapons:', e);
            res.json({ weapons: [], error: e.message });
        }
    });

    app.post('/api/crafts/weapons', requireAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'plan_image', maxCount: 1 }]), (req, res) => {
        try {
            const { name, craft_time, craft_price, sale_price, max_sale_price, ingredients, requires_plan } = req.body;
            if (!name) return res.status(400).json({ error: 'Nom requis' });
            const imagePath = req.files?.image?.[0]?.filename || null;
            const planImagePath = req.files?.plan_image?.[0]?.filename || null;
            const normalizedIngredients = normalizeIngredientsPayload(ingredients || '[]');
            const craftTimeValue = parseNonNegativeInteger(craft_time, 0);
            const craftPriceValue = parseNonNegativeInteger(craft_price, 0);
            const salePriceValue = parseNonNegativeInteger(sale_price, 0);
            const maxSalePriceValue = parseNonNegativeInteger(max_sale_price, 0);
            if ([craftTimeValue, craftPriceValue, salePriceValue, maxSalePriceValue].some(v => v === null)) {
                return res.status(400).json({ error: 'Valeur numérique invalide' });
            }
            const requiresPlanValue = requires_plan === '1' || requires_plan === 'true' || requires_plan === true;
            const id = insertWeapon(
                name, imagePath, planImagePath,
                requiresPlanValue,
                craftTimeValue,
                craftPriceValue,
                salePriceValue,
                maxSalePriceValue,
                JSON.stringify(normalizedIngredients)
            );
            audit(req.session.user, 'catalog.weapon.create', {
                target_type: 'catalog_weapon',
                target_id: id,
                details: { name, craft_time, craft_price, sale_price, max_sale_price, requires_plan },
            });
            res.json({ success: true, id });
        } catch (e) { cleanupUploadedFiles(req); sendRouteError(res, e); }
    });

    app.put('/api/crafts/weapons/:id', requireAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'plan_image', maxCount: 1 }]), (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const { name, craft_time, craft_price, sale_price, max_sale_price, ingredients, requires_plan } = req.body;
            const existing = getWeapon(id);
            if (!existing) return res.status(404).json({ error: 'Arme introuvable' });

            const newImage = req.files?.image?.[0]?.filename || null;
            const newPlan = req.files?.plan_image?.[0]?.filename || null;
            const normalizedIngredients = ingredients !== undefined
                ? normalizeIngredientsPayload(ingredients)
                : safeParseIngredients(existing.ingredients);
            const craftTimeValue = parseNonNegativeInteger(craft_time, existing.craft_time || 0);
            const craftPriceValue = parseNonNegativeInteger(craft_price, existing.craft_price || 0);
            const salePriceValue = parseNonNegativeInteger(sale_price, existing.sale_price || 0);
            const maxSalePriceValue = parseNonNegativeInteger(max_sale_price, existing.max_sale_price || 0);
            if ([craftTimeValue, craftPriceValue, salePriceValue, maxSalePriceValue].some(v => v === null)) {
                return res.status(400).json({ error: 'Valeur numérique invalide' });
            }
            const requiresPlanValue = requires_plan === undefined
                ? !!existing.requires_plan
                : (requires_plan === '1' || requires_plan === 'true' || requires_plan === true);

            updateWeapon(
                id, name || existing.name, newImage, newPlan,
                requiresPlanValue,
                craftTimeValue,
                craftPriceValue,
                salePriceValue,
                maxSalePriceValue,
                JSON.stringify(normalizedIngredients)
            );
            if (newImage && existing.image_path) {
                safeDeleteUpload(existing.image_path);
            }
            if (newPlan && existing.plan_image_path) {
                safeDeleteUpload(existing.plan_image_path);
            }
            audit(req.session.user, 'catalog.weapon.update', {
                target_type: 'catalog_weapon',
                target_id: id,
                details: { name: name || existing.name, craft_time, craft_price, sale_price, max_sale_price, requires_plan },
            });
            res.json({ success: true });
        } catch (e) { cleanupUploadedFiles(req); sendRouteError(res, e); }
    });

    app.delete('/api/crafts/weapons/:id', requireAdmin, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const existing = getWeapon(id);
            deleteWeapon(id);
            if (existing && existing.image_path) {
                safeDeleteUpload(existing.image_path);
            }
            if (existing && existing.plan_image_path) {
                safeDeleteUpload(existing.plan_image_path);
            }
            audit(req.session.user, 'catalog.weapon.delete', {
                target_type: 'catalog_weapon',
                target_id: id,
                details: { name: existing?.name || null },
            });
            res.json({ success: true });
        } catch (e) { cleanupUploadedFiles(req); sendRouteError(res, e); }
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
            audit(req.session.user, 'catalog.ingredient.create', {
                target_type: 'catalog_ingredient',
                target_id: id,
                details: { name: name.trim(), imagePath },
            });
            res.json({ success: true, id });
        } catch (e) { cleanupUploadedFiles(req); sendRouteError(res, e); }
    });

    app.put('/api/crafts/ingredients/:id', requireAdmin, upload.single('image'), (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const { name } = req.body;
            const existing = getIngredient(id);
            if (!existing) return res.status(404).json({ error: 'Ingrédient introuvable' });
            updateIngredient(id, name || existing.name, req.file ? req.file.filename : null);
            if (req.file && existing.image_path) {
                safeDeleteUpload(existing.image_path);
            }
            audit(req.session.user, 'catalog.ingredient.update', {
                target_type: 'catalog_ingredient',
                target_id: id,
                details: { name: name || existing.name, imagePath: req.file ? req.file.filename : null },
            });
            res.json({ success: true });
        } catch (e) { cleanupUploadedFiles(req); sendRouteError(res, e); }
    });

    app.delete('/api/crafts/ingredients/:id', requireAdmin, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const existing = getIngredient(id);
            deleteIngredient(id);
            if (existing && existing.image_path) {
                safeDeleteUpload(existing.image_path);
            }
            audit(req.session.user, 'catalog.ingredient.delete', {
                target_type: 'catalog_ingredient',
                target_id: id,
                details: { name: existing?.name || null },
            });
            res.json({ success: true });
        } catch (e) { sendRouteError(res, e); }
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
            audit(req.session.user, 'catalog.myWeaponName.create', {
                target_type: 'my_weapon_name',
                target_id: id,
                details: { name, sale_price, max_sale_price },
            });
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/crafts/myweapon-names/:id', requireAdmin, (req, res) => {
        try {
            const { name, sale_price, max_sale_price } = req.body;
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            updateMyWeaponName(id, name, sale_price, max_sale_price);
            audit(req.session.user, 'catalog.myWeaponName.update', {
                target_type: 'my_weapon_name',
                target_id: id,
                details: { name, sale_price, max_sale_price },
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/myweapon-names/:id', requireAdmin, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            deleteMyWeaponName(id);
            audit(req.session.user, 'catalog.myWeaponName.delete', {
                target_type: 'my_weapon_name',
                target_id: id,
            });
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
            audit(req.session.user, 'config.organization.create', {
                target_type: 'organization',
                target_id: id,
                details: { name: name.trim() },
            });
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/organizations/:id', requireAdmin, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            deleteOrg(id);
            audit(req.session.user, 'config.organization.delete', {
                target_type: 'organization',
                target_id: id,
            });
            res.json({ success: true });
        }
        catch (e) { res.status(500).json({ error: e.message }); }
    });


}

module.exports = {
    registerCraftCatalogRoutes,
    _test: {
        normalizeIngredientsPayload,
    },
};
