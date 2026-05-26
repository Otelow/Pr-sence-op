// COMMANDES GROUPES 26/05/2026 — commandes armes organisations

function createServiceError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function cleanMoney(value) {
    const parsed = parseInt(String(value ?? '').replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function cleanPercent(value) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(100, Math.max(0, parsed));
}

function cleanPositiveInt(value, fieldName = 'quantité') {
    const parsed = parseInt(String(value ?? '').replace(/[^\d-]/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw createServiceError(`${fieldName} invalide`);
    }
    return parsed;
}

function cleanOptionalId(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function actorId(actor) {
    return String(actor?.id || actor?.user_id || '').trim() || null;
}

function actorName(actor) {
    return String(actor?.username || actor?.global_name || actor?.name || actor?.displayName || actor?.id || '').trim() || null;
}

function calculateTotals(items, discountPercent) {
    const subtotal = items.reduce((sum, item) => {
        return sum + ((Number(item.unit_price) || 0) * (Number(item.quantity) || 0));
    }, 0);
    const discount = Math.round(subtotal * cleanPercent(discountPercent) / 100);
    return {
        subtotal_amount: subtotal,
        discount_percent: cleanPercent(discountPercent),
        discount_amount: discount,
        total_amount: Math.max(0, subtotal - discount),
    };
}

function safeParseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeSerialNumbers(value) {
    const raw = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n,;]+/);
    return raw
        .map(serial => String(serial || '').trim())
        .filter(Boolean);
}

function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
}

function createGroupOrderService(deps) {
    const {
        getDb,
        getAllOrgs,
        getAllMyWeaponNamesWithPriceLimits,
        getWeaponByName,
    } = deps;

    function db() {
        const connection = getDb();
        if (!connection) throw createServiceError('Base de données indisponible', 500);
        return connection;
    }

    function getOrganizations() {
        const rows = typeof getAllOrgs === 'function' ? getAllOrgs() : [];
        return Array.isArray(rows) ? rows : [];
    }

    function getWeaponCatalog() {
        const rows = typeof getAllMyWeaponNamesWithPriceLimits === 'function'
            ? getAllMyWeaponNamesWithPriceLimits()
            : [];
        const names = Array.isArray(rows) ? rows : [];
        return names.map(item => {
            const maxSalePrice = cleanMoney(item.max_sale_price);
            return {
                id: item.id,
                name: item.name,
                sale_price: cleanMoney(item.sale_price),
                max_sale_price: maxSalePrice,
                has_max_price: maxSalePrice > 0,
                price_source: item.price_source || null,
            };
        });
    }

    function resolveOrganization(payload = {}) {
        const organizations = getOrganizations();
        const requestedId = cleanOptionalId(payload.organization_id);
        const requestedName = normalizeName(payload.organization_name);
        const found = requestedId
            ? organizations.find(org => Number(org.id) === requestedId)
            : organizations.find(org => normalizeName(org.name) === requestedName);

        if (!found) {
            throw createServiceError('Organisation introuvable');
        }
        return { id: Number(found.id), name: String(found.name || '').trim() };
    }

    function resolveWeapon(payload = {}) {
        const catalog = getWeaponCatalog();
        const requestedCatalogId = cleanOptionalId(payload.weapon_catalog_id || payload.catalog_id || payload.weapon_name_id);
        const requestedId = cleanOptionalId(payload.weapon_id);
        const requestedName = normalizeName(payload.weapon_name || payload.name);

        let found = null;
        if (requestedCatalogId) {
            found = catalog.find(weapon => Number(weapon.id) === requestedCatalogId);
        }
        if (!found && requestedName) {
            found = catalog.find(weapon => normalizeName(weapon.name) === requestedName);
        }
        if (!found && requestedId) {
            found = catalog.find(weapon => Number(weapon.id) === requestedId);
        }

        const weaponName = String(found?.name || payload.weapon_name || payload.name || '').trim();
        if (!weaponName) {
            throw createServiceError('Arme obligatoire');
        }

        const maxSalePrice = cleanMoney(found?.max_sale_price);
        if (maxSalePrice <= 0) {
            throw createServiceError('Prix maximal non configuré pour cette arme');
        }

        const weaponRow = typeof getWeaponByName === 'function' ? getWeaponByName(weaponName) : null;
        return {
            weapon_id: cleanOptionalId(weaponRow?.id),
            weapon_name: weaponName,
            unit_price: maxSalePrice,
        };
    }

    function getItemRows(orderId) {
        return db().prepare(`
            SELECT *
            FROM group_order_items
            WHERE order_id = ?
            ORDER BY id ASC
        `).all(orderId);
    }

    function getCraftRows(orderId) {
        return db().prepare(`
            SELECT *
            FROM group_order_crafts
            WHERE order_id = ?
            ORDER BY created_at DESC, id DESC
        `).all(orderId).map(row => ({
            ...row,
            serial_numbers: safeParseJsonArray(row.serial_numbers),
        }));
    }

    function computeProgress(items) {
        const ordered = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
        const crafted = items.reduce((sum, item) => sum + (Number(item.crafted_quantity) || 0), 0);
        return {
            ordered,
            crafted,
            remaining: Math.max(0, ordered - crafted),
            percent: ordered > 0 ? Math.round((crafted / ordered) * 100) : 0,
        };
    }

    function statusFromItems(items, currentStatus) {
        if (currentStatus === 'cancelled') return 'cancelled';
        const progress = computeProgress(items);
        if (progress.ordered <= 0 || progress.crafted <= 0) return 'open';
        if (progress.crafted >= progress.ordered) return 'crafted';
        return 'partial';
    }

    function hydrateOrder(row) {
        if (!row) return null;
        const items = getItemRows(row.id);
        const crafts = getCraftRows(row.id);
        const progress = computeProgress(items);
        return {
            ...row,
            discount_percent: Number(row.discount_percent) || 0,
            items,
            crafts,
            progress,
        };
    }

    function getGroupOrderCatalog() {
        return {
            organizations: getOrganizations(),
            weapons: getWeaponCatalog(),
        };
    }

    function getGroupOrders() {
        return db().prepare(`
            SELECT *
            FROM group_orders
            ORDER BY created_at DESC, id DESC
        `).all().map(hydrateOrder);
    }

    function getGroupOrder(id) {
        const orderId = cleanOptionalId(id);
        if (!orderId) throw createServiceError('ID commande invalide');
        const row = db().prepare('SELECT * FROM group_orders WHERE id = ?').get(orderId);
        if (!row) throw createServiceError('Commande groupe introuvable', 404);
        return hydrateOrder(row);
    }

    function normalizeOrderItems(payloadItems, existingItems = new Map()) {
        if (!Array.isArray(payloadItems) || payloadItems.length === 0) {
            throw createServiceError('Ajoute au moins une arme à la commande');
        }

        const normalized = [];
        const seen = new Set();
        for (const raw of payloadItems) {
            const existingId = cleanOptionalId(raw.id || raw.item_id);
            const weapon = resolveWeapon(raw);
            const quantity = cleanPositiveInt(raw.quantity, 'Quantité arme');
            const key = existingId ? `id:${existingId}` : `name:${normalizeName(weapon.weapon_name)}`;
            if (seen.has(key)) {
                throw createServiceError(`Arme en double dans la commande : ${weapon.weapon_name}`);
            }
            seen.add(key);

            const existing = existingId ? existingItems.get(existingId) : null;
            const craftedQuantity = Number(existing?.crafted_quantity) || 0;
            if (craftedQuantity > quantity) {
                throw createServiceError(`Impossible de réduire ${weapon.weapon_name} sous la quantité déjà craftée (${craftedQuantity})`);
            }

            normalized.push({
                id: existingId,
                ...weapon,
                quantity,
                line_total: weapon.unit_price * quantity,
                crafted_quantity: craftedQuantity,
            });
        }
        return normalized;
    }

    function updateOrderStatus(orderId, txDb = db()) {
        const row = txDb.prepare('SELECT status FROM group_orders WHERE id = ?').get(orderId);
        if (!row || row.status === 'cancelled') return row?.status || null;
        const items = txDb.prepare('SELECT quantity, crafted_quantity FROM group_order_items WHERE order_id = ?').all(orderId);
        const status = statusFromItems(items, row.status);
        txDb.prepare('UPDATE group_orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowSeconds(), orderId);
        return status;
    }

    function upsertGroupOrder(payload, actor, id = null) {
        const connection = db();
        const orderId = cleanOptionalId(id);
        const tx = connection.transaction(() => {
            const organization = resolveOrganization(payload);
            const existing = orderId
                ? connection.prepare('SELECT * FROM group_orders WHERE id = ?').get(orderId)
                : null;
            if (orderId && !existing) throw createServiceError('Commande groupe introuvable', 404);
            if (existing?.status === 'cancelled') {
                throw createServiceError('Impossible de modifier une commande annulée', 409);
            }

            const existingItems = new Map(orderId ? getItemRows(orderId).map(item => [Number(item.id), item]) : []);
            const items = normalizeOrderItems(payload.items, existingItems);
            const totals = calculateTotals(items, payload.discount_percent);
            const timestamp = nowSeconds();
            const cleanOrderDate = String(payload.order_date || '').trim() || todayIsoDate();
            const note = String(payload.note || '').trim() || null;
            const cleanActorId = actorId(actor);
            const cleanActorName = actorName(actor);

            let finalOrderId = orderId;
            if (existing) {
                connection.prepare(`
                    UPDATE group_orders
                    SET organization_id = ?, organization_name = ?, order_date = ?,
                        subtotal_amount = ?, discount_percent = ?, discount_amount = ?, total_amount = ?,
                        note = ?, updated_by_id = ?, updated_by_name = ?, updated_at = ?
                    WHERE id = ?
                `).run(
                    organization.id,
                    organization.name,
                    cleanOrderDate,
                    totals.subtotal_amount,
                    totals.discount_percent,
                    totals.discount_amount,
                    totals.total_amount,
                    note,
                    cleanActorId,
                    cleanActorName,
                    timestamp,
                    orderId
                );
            } else {
                const result = connection.prepare(`
                    INSERT INTO group_orders (
                        organization_id, organization_name, order_date,
                        subtotal_amount, discount_percent, discount_amount, total_amount,
                        status, note, created_by_id, created_by_name, updated_by_id, updated_by_name,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    organization.id,
                    organization.name,
                    cleanOrderDate,
                    totals.subtotal_amount,
                    totals.discount_percent,
                    totals.discount_amount,
                    totals.total_amount,
                    note,
                    cleanActorId,
                    cleanActorName,
                    cleanActorId,
                    cleanActorName,
                    timestamp,
                    timestamp
                );
                finalOrderId = Number(result.lastInsertRowid);
            }

            const incomingIds = new Set(items.map(item => item.id).filter(Boolean));
            for (const [existingItemId, existingItem] of existingItems) {
                if (!incomingIds.has(existingItemId)) {
                    if (Number(existingItem.crafted_quantity) > 0) {
                        throw createServiceError(`Impossible de retirer ${existingItem.weapon_name}, déjà craftée`);
                    }
                    connection.prepare('DELETE FROM group_order_items WHERE id = ? AND order_id = ?').run(existingItemId, finalOrderId);
                }
            }

            for (const item of items) {
                if (item.id && existingItems.has(item.id)) {
                    connection.prepare(`
                        UPDATE group_order_items
                        SET weapon_id = ?, weapon_name = ?, unit_price = ?, quantity = ?, line_total = ?, updated_at = ?
                        WHERE id = ? AND order_id = ?
                    `).run(
                        item.weapon_id,
                        item.weapon_name,
                        item.unit_price,
                        item.quantity,
                        item.line_total,
                        timestamp,
                        item.id,
                        finalOrderId
                    );
                } else {
                    connection.prepare(`
                        INSERT INTO group_order_items (
                            order_id, weapon_id, weapon_name, unit_price, quantity, line_total,
                            crafted_quantity, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                    `).run(
                        finalOrderId,
                        item.weapon_id,
                        item.weapon_name,
                        item.unit_price,
                        item.quantity,
                        item.line_total,
                        timestamp,
                        timestamp
                    );
                }
            }

            updateOrderStatus(finalOrderId, connection);
            return finalOrderId;
        });

        const finalId = tx();
        return getGroupOrder(finalId);
    }

    function assertUniqueSerials(orderId, incomingSerials, connection) {
        const normalizedIncoming = incomingSerials.map(normalizeName).filter(Boolean);
        const incomingSet = new Set();
        for (const serial of normalizedIncoming) {
            if (incomingSet.has(serial)) throw createServiceError(`Numéro de série en double : ${serial}`);
            incomingSet.add(serial);
        }

        if (incomingSet.size === 0) return;
        const rows = connection.prepare('SELECT serial_numbers FROM group_order_crafts WHERE order_id = ?').all(orderId);
        const existing = new Set();
        for (const row of rows) {
            for (const serial of safeParseJsonArray(row.serial_numbers)) {
                const key = normalizeName(serial);
                if (key) existing.add(key);
            }
        }
        for (const serial of incomingSet) {
            if (existing.has(serial)) throw createServiceError(`Numéro de série déjà renseigné dans cette commande : ${serial}`);
        }
    }

    function recordGroupOrderCraft(orderId, payload, actor) {
        const finalOrderId = cleanOptionalId(orderId);
        if (!finalOrderId) throw createServiceError('ID commande invalide');
        const connection = db();
        const tx = connection.transaction(() => {
            const order = connection.prepare('SELECT * FROM group_orders WHERE id = ?').get(finalOrderId);
            if (!order) throw createServiceError('Commande groupe introuvable', 404);
            if (order.status === 'cancelled') throw createServiceError('Commande annulée', 409);

            const rawItems = Array.isArray(payload.items) ? payload.items : [];
            if (rawItems.length === 0) throw createServiceError('Ajoute au moins une arme craftée');

            const timestamp = nowSeconds();
            const craftDate = String(payload.craft_date || '').trim() || todayIsoDate();
            const craftedById = String(payload.crafted_by_id || actorId(actor) || '').trim() || null;
            const craftedByName = String(payload.crafted_by_name || actorName(actor) || '').trim() || null;
            const note = String(payload.note || '').trim() || null;
            const allIncomingSerials = rawItems.flatMap(item => normalizeSerialNumbers(item.serial_numbers));
            assertUniqueSerials(finalOrderId, allIncomingSerials, connection);

            for (const raw of rawItems) {
                const itemId = cleanOptionalId(raw.item_id || raw.id);
                if (!itemId) throw createServiceError('Ligne de commande invalide');
                const item = connection.prepare(`
                    SELECT *
                    FROM group_order_items
                    WHERE id = ? AND order_id = ?
                `).get(itemId, finalOrderId);
                if (!item) throw createServiceError('Ligne de commande introuvable', 404);

                const quantity = cleanPositiveInt(raw.quantity, `Quantité craftée ${item.weapon_name}`);
                const remaining = (Number(item.quantity) || 0) - (Number(item.crafted_quantity) || 0);
                if (quantity > remaining) {
                    throw createServiceError(`Impossible de dépasser le restant pour ${item.weapon_name} (${remaining})`);
                }

                const serialNumbers = normalizeSerialNumbers(raw.serial_numbers);
                connection.prepare(`
                    INSERT INTO group_order_crafts (
                        order_id, item_id, weapon_id, weapon_name, quantity, serial_numbers,
                        crafted_by_id, crafted_by_name, craft_date, note, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    finalOrderId,
                    itemId,
                    item.weapon_id,
                    item.weapon_name,
                    quantity,
                    JSON.stringify(serialNumbers),
                    craftedById,
                    craftedByName,
                    craftDate,
                    note,
                    timestamp
                );
                connection.prepare(`
                    UPDATE group_order_items
                    SET crafted_quantity = crafted_quantity + ?, updated_at = ?
                    WHERE id = ? AND order_id = ?
                `).run(quantity, timestamp, itemId, finalOrderId);
            }

            connection.prepare(`
                UPDATE group_orders
                SET updated_by_id = ?, updated_by_name = ?, updated_at = ?
                WHERE id = ?
            `).run(actorId(actor), actorName(actor), timestamp, finalOrderId);
            updateOrderStatus(finalOrderId, connection);
        });

        tx();
        return getGroupOrder(finalOrderId);
    }

    function cancelGroupOrder(id, actor) {
        const orderId = cleanOptionalId(id);
        if (!orderId) throw createServiceError('ID commande invalide');
        const connection = db();
        const tx = connection.transaction(() => {
            const order = connection.prepare('SELECT * FROM group_orders WHERE id = ?').get(orderId);
            if (!order) throw createServiceError('Commande groupe introuvable', 404);
            connection.prepare(`
                UPDATE group_orders
                SET status = 'cancelled', updated_by_id = ?, updated_by_name = ?, updated_at = ?
                WHERE id = ?
            `).run(actorId(actor), actorName(actor), nowSeconds(), orderId);
        });
        tx();
        return getGroupOrder(orderId);
    }

    function deleteGroupOrder(id, actor) {
        const orderId = cleanOptionalId(id);
        if (!orderId) throw createServiceError('ID commande invalide');
        const connection = db();
        const tx = connection.transaction(() => {
            const order = connection.prepare('SELECT * FROM group_orders WHERE id = ?').get(orderId);
            if (!order) throw createServiceError('Commande groupe introuvable', 404);
            const craftsCount = connection.prepare('SELECT COUNT(*) AS c FROM group_order_crafts WHERE order_id = ?').get(orderId).c;
            if (Number(craftsCount) > 0) {
                connection.prepare(`
                    UPDATE group_orders
                    SET status = 'cancelled', updated_by_id = ?, updated_by_name = ?, updated_at = ?
                    WHERE id = ?
                `).run(actorId(actor), actorName(actor), nowSeconds(), orderId);
                return 'cancelled';
            }
            connection.prepare('DELETE FROM group_orders WHERE id = ?').run(orderId);
            return 'deleted';
        });
        return tx();
    }

    return {
        getGroupOrderCatalog,
        getGroupOrders,
        getGroupOrder,
        upsertGroupOrder,
        recordGroupOrderCraft,
        cancelGroupOrder,
        deleteGroupOrder,
        calculateTotals,
    };
}

module.exports = {
    createGroupOrderService,
    cleanMoney,
    cleanPercent,
    calculateTotals,
};
