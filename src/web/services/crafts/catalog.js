// MODIFIE CHANTIER 6 - 14/05/2026 - referentiels craft/admin extraits de crafts.js

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

function createCatalogService(deps) {
    const {
        getDb,
        invalidateCraftCaches,
        seedStockMaterials,
        isStockMaterialName,
    } = deps;
    const db = createDbProxy(getDb);

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



    return {
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
    };
}

module.exports = {
    createCatalogService,
};