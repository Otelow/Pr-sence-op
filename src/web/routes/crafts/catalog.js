// MODIFIE CHANTIER 6 - 14/05/2026 - routes catalogue/stock craft extraites

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
                const p = path.join(uploadsDir, existing.image_path);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            if (newPlan && existing.plan_image_path) {
                const p = path.join(uploadsDir, existing.plan_image_path);
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
                const p = path.join(uploadsDir, existing.image_path);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            if (existing && existing.plan_image_path) {
                const p = path.join(uploadsDir, existing.plan_image_path);
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
                const p = path.join(uploadsDir, existing.image_path);
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
                const p = path.join(uploadsDir, existing.image_path);
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


}

module.exports = {
    registerCraftCatalogRoutes,
};