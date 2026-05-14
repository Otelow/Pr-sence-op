// MODIFIE CHANTIER 6 - 14/05/2026 - service demandes craft extrait de crafts.js

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

function createCraftRequestService(deps) {
    const {
        getDb,
        productionStatuses,
        getWeapon,
        consumeStockForCraftRequest,
        restoreStockForCraftRequest,
        invalidateCraftCaches,
    } = deps;
    const db = createDbProxy(getDb);

function getRequests(status, options = {}) {
    let query = `SELECT r.*, w.name as weapon_name, w.image_path as weapon_image, w.craft_price as weapon_craft_price FROM craft_requests r JOIN weapons w ON r.weapon_id = w.id`;
    const params = [];
    const where = [];
    if (options.productionOnly) {
        where.push(`r.status IN (${productionStatuses.map(() => '?').join(',')})`);
        params.push(...productionStatuses);
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

    return {
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
    };
}

module.exports = {
    createCraftRequestService,
};