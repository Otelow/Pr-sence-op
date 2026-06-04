// MODIFIE CHANTIER 6 - 14/05/2026 - stock et catalogue craftable extraits de crafts.js

const CRAFTABLE_CACHE_TTL_MS = 10_000;

function createDbProxy(getDb) {
    return new Proxy({}, {
        get(_target, prop) {
            const db = getDb();
            if (!db) throw new Error('Base crafts non initialisee');
            const value = db[prop];
            return typeof value === 'function' ? value.bind(db) : value;
        },
    });
}

function parseWeaponIngredients(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function createStockService(deps) {
    const {
        getDb,
        getAllWeapons,
        getAllIngredients,
        getIngredient,
        getWeapon,
        getRequests,
        normalizeStockName,
        getCanonicalStockMaterialName,
        isStockMaterialName,
        stockMaterialNames,
        reservedStatuses,
    } = deps;

    const db = createDbProxy(getDb);
    let craftableWeaponsCache = null;
    let craftableWeaponsCacheExpiresAt = 0;

    function invalidateCraftCaches() {
        craftableWeaponsCache = null;
        craftableWeaponsCacheExpiresAt = 0;
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
        return stockMaterialNames
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
            if (request.out_of_stock) continue;
            if (request.stock_consumed_at) continue;
            if (!reservedStatuses.includes(request.status)) continue;
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

    return {
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
    };
}

module.exports = {
    createStockService,
    parseWeaponIngredients,
};
