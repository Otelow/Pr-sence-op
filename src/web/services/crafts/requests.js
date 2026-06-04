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

function createStockError(message, statusCode = 400) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

const VALID_CRAFT_STATUSES = new Set(['pending', 'waiting_materials', 'in_progress', 'crafted', 'completed', 'rejected']);
const STATUS_ROLLBACK_TARGETS = new Set(['pending', 'waiting_materials', 'in_progress', 'rejected']);

function createCraftRequestService(deps) {
    const {
        getDb,
        productionStatuses,
        consumeStockForCraftRequest,
        restoreStockForCraftRequest,
        invalidateCraftCaches,
    } = deps;
    const db = createDbProxy(getDb);

    function getRequests(status, options = {}) {
        let query = 'SELECT r.*, w.name as weapon_name, w.image_path as weapon_image, w.craft_price as weapon_craft_price FROM craft_requests r JOIN weapons w ON r.weapon_id = w.id';
        const params = [];
        const where = [];
        if (options.productionOnly) {
            where.push(`r.status IN (${productionStatuses.map(() => '?').join(',')})`);
            params.push(...productionStatuses);
        } else if (status && status !== 'all') {
            where.push('r.status = ?');
            params.push(status);
        }
        if (options.hideTests) where.push('COALESCE(r.is_test, 0) = 0');
        if (where.length) query += ` WHERE ${where.join(' AND ')}`;
        query += ' ORDER BY r.created_at DESC';
        return db.prepare(query).all(...params);
    }

    function getRequest(id) {
        return db.prepare('SELECT r.*, w.name as weapon_name, w.image_path as weapon_image FROM craft_requests r JOIN weapons w ON r.weapon_id = w.id WHERE r.id = ?').get(id);
    }

    function normalizeCraftRequestType(value) {
        const clean = String(value || '').trim();
        return ['sale', 'personal'].includes(clean) ? clean : null;
    }

    function insertRequest(user_id, user_name, weapon_id, has_plan, has_money, request_type, is_test = false, out_of_stock = false) {
        const normalizedType = normalizeCraftRequestType(request_type);
        const r = db.prepare('INSERT INTO craft_requests (user_id, user_name, weapon_id, has_plan, has_money, request_type, is_test, out_of_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(user_id, user_name, weapon_id, has_plan ? 1 : 0, has_money ? 1 : 0, normalizedType, is_test ? 1 : 0, out_of_stock ? 1 : 0);
        return r.lastInsertRowid;
    }

    function shouldConsumeDynamicStock(request) {
        return !request.is_test && !request.out_of_stock;
    }

    function isPermanentWeaponLink(weapon) {
        return weapon.is_sold === 1 || weapon.is_sold === true || weapon.is_sold === '1'
            || weapon.sale_discord_message_id
            || weapon.weapons_log_message_id
            || weapon.discord_message_id;
    }

    function applyCraftRequestStatusTransition(id, targetStatus, options = {}) {
        const status = String(targetStatus || '').trim();
        if (!VALID_CRAFT_STATUSES.has(status)) throw createStockError('Statut invalide', 400);

        const now = Number(options.now) || Math.floor(Date.now() / 1000);
        const current = getRequest(id);
        if (!current) throw createStockError('Demande introuvable', 404);
        if (current.status === status && !options.force) {
            return { previous: current, updated: current, changed: false };
        }
        if (current.status === 'completed' && status !== 'completed') {
            throw createStockError('Craft finalise : transition arriere interdite depuis le dashboard', 409);
        }

        const linkedWeapons = getLinkedMyWeaponsForRequest(current);
        const rollbackCraftFields = STATUS_ROLLBACK_TARGETS.has(status);
        if (rollbackCraftFields && linkedWeapons.some(isPermanentWeaponLink)) {
            throw createStockError('Transition interdite : arme vendue ou loguee liee a cette demande', 409);
        }

        if (status === 'crafted') {
            const serial = String(options.serial ?? current.serial_number ?? '').trim();
            if (!serial) throw createStockError('Numero de serie obligatoire pour passer en crafte', 400);
            if (shouldConsumeDynamicStock(current) && !current.stock_consumed_at) {
                consumeStockForCraftRequest(current, now);
            }
            db.prepare(`
                UPDATE craft_requests
                SET status = 'crafted',
                    crafted = 1,
                    serial_number = ?,
                    craft_date = ?,
                    crafted_by_id = ?,
                    crafted_by_name = ?,
                    completed_by_id = NULL,
                    completed_by_name = NULL
                WHERE id = ?
            `).run(serial, now, options.craftedById || null, options.craftedByName || null, id);
            return { previous: current, updated: getRequest(id), changed: true };
        }

        if (status === 'completed') {
            const nextBuyerOrg = Object.prototype.hasOwnProperty.call(options, 'buyerOrg') ? (options.buyerOrg || null) : (current.buyer_org || null);
            const nextSalePrice = Object.prototype.hasOwnProperty.call(options, 'salePrice') ? options.salePrice : current.sale_price;
            const nextSaleDate = Object.prototype.hasOwnProperty.call(options, 'saleDate') ? options.saleDate : current.sale_date;
            const nextCompletedById = Object.prototype.hasOwnProperty.call(options, 'completedById') ? (options.completedById || null) : (current.completed_by_id || null);
            const nextCompletedByName = Object.prototype.hasOwnProperty.call(options, 'completedByName') ? (options.completedByName || null) : (current.completed_by_name || null);
            db.prepare(`
                UPDATE craft_requests
                SET status = 'completed',
                    buyer_org = ?,
                    sale_price = ?,
                    sale_date = ?,
                    completed_by_id = ?,
                    completed_by_name = ?
                WHERE id = ?
            `).run(nextBuyerOrg, nextSalePrice, nextSaleDate, nextCompletedById, nextCompletedByName, id);
            return { previous: current, updated: getRequest(id), changed: true };
        }

        if (current.stock_consumed_at && rollbackCraftFields) {
            restoreStockForCraftRequest(current, now);
        }

        if (linkedWeapons.length && rollbackCraftFields) {
            const deleteWeapon = db.prepare('DELETE FROM my_weapons WHERE id = ?');
            linkedWeapons.forEach(w => deleteWeapon.run(w.id));
        }

        db.prepare(`
            UPDATE craft_requests
            SET status = ?,
                refusal_reason = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END,
                crafted = CASE WHEN ? THEN 0 ELSE crafted END,
                serial_number = CASE WHEN ? THEN NULL ELSE serial_number END,
                craft_date = CASE WHEN ? THEN NULL ELSE craft_date END,
                stock_consumed_at = CASE WHEN ? THEN NULL ELSE stock_consumed_at END,
                crafted_by_id = CASE WHEN ? THEN NULL ELSE crafted_by_id END,
                crafted_by_name = CASE WHEN ? THEN NULL ELSE crafted_by_name END,
                completed_by_id = NULL,
                completed_by_name = NULL,
                buyer_org = CASE WHEN ? THEN NULL ELSE buyer_org END,
                sale_price = CASE WHEN ? THEN NULL ELSE sale_price END,
                sale_date = CASE WHEN ? THEN NULL ELSE sale_date END
            WHERE id = ?
        `).run(
            status,
            status, options.reason || null,
            rollbackCraftFields ? 1 : 0,
            rollbackCraftFields ? 1 : 0,
            rollbackCraftFields ? 1 : 0,
            rollbackCraftFields ? 1 : 0,
            rollbackCraftFields ? 1 : 0,
            rollbackCraftFields ? 1 : 0,
            rollbackCraftFields ? 1 : 0,
            rollbackCraftFields ? 1 : 0,
            rollbackCraftFields ? 1 : 0,
            id
        );
        return { previous: current, updated: getRequest(id), changed: true };
    }

    function transitionCraftRequestStatus(id, targetStatus, options = {}) {
        const tx = db.transaction(() => applyCraftRequestStatusTransition(id, targetStatus, options));
        const result = tx();
        invalidateCraftCaches();
        return result;
    }

    function updateRequestCraft(id, crafted, serial, userId, userName) {
        return transitionCraftRequestStatus(id, crafted ? 'crafted' : 'in_progress', {
            serial,
            craftedById: userId,
            craftedByName: userName,
        });
    }

    function updateRequestSale(id, buyer_org, sale_price, sale_date, userId, userName) {
        return transitionCraftRequestStatus(id, 'completed', {
            buyerOrg: buyer_org,
            salePrice: sale_price ?? null,
            saleDate: sale_date,
            completedById: userId,
            completedByName: userName,
        });
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
        if (!request) throw createStockError('Demande introuvable', 404);

        const runDelete = () => {
            const linkedWeapons = getLinkedMyWeaponsForRequest(request);
            const soldOrLogged = linkedWeapons.find(isPermanentWeaponLink);
            if (soldOrLogged) {
                throw createStockError('Impossible de supprimer une demande deja vendue ou loguee definitivement', 409);
            }

            if (request.stock_consumed_at) {
                restoreStockForCraftRequest(request, Math.floor(Date.now() / 1000));
            }

            if (linkedWeapons.length) {
                const deleteWeapon = db.prepare('DELETE FROM my_weapons WHERE id = ?');
                linkedWeapons.forEach(w => deleteWeapon.run(w.id));
            }
            db.prepare('DELETE FROM craft_requests WHERE id = ?').run(id);
        };

        db.transaction(runDelete)();
        invalidateCraftCaches();
    }

    return {
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
    };
}

module.exports = {
    createCraftRequestService,
    createStockError,
    VALID_CRAFT_STATUSES,
};
