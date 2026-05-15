// FINAL POST-STAB A 17/05/2026 ? pino backend
const log = require('../../../shared/logger');
// CHANTIER COMMANDES 15/05/2026 — commandes structurées et publication Discord
// MODIFIE CHANTIER 6 - 14/05/2026 - service suivi commandes/avances extrait de crafts.js

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

function createOrderAdvanceService(deps) {
    const { getDb, getBotClient, catalog = [] } = deps;
    const db = createDbProxy(getDb);
    const ORDER_DISCORD_CHANNEL_ID = '1504837371261354188';

function cleanMoney(value) {
    const parsed = parseInt(String(value ?? '').replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function orderAdvanceTitle(orderDate) {
    return `Commande matières premières du ${orderDate || todayIsoDate()}`;
}

function formatMoney(value) {
    return `${(Number(value) || 0).toLocaleString('fr-FR')} $`;
}

function normalizeOrderItems(items = []) {
    const byCatalog = new Map(catalog.map(item => [String(item.name).toLowerCase(), item]));
    return (Array.isArray(items) ? items : [])
        .map(item => {
            const ingredientName = String(item.ingredient_name || item.name || '').trim();
            if (!ingredientName) return null;
            const catalogItem = byCatalog.get(ingredientName.toLowerCase());
            const unitPrice = cleanMoney(catalogItem?.unit_price || item.unit_price);
            const quantity = Math.max(0, parseInt(item.quantity, 10) || 0);
            if (!unitPrice || quantity <= 0) return null;
            return {
                ingredient_name: catalogItem?.name || ingredientName,
                unit_price: unitPrice,
                quantity,
                line_total: unitPrice * quantity,
            };
        })
        .filter(Boolean);
}

function getOrderAdvanceCatalog() {
    const ingredientRows = db.prepare('SELECT name, image_path FROM ingredients').all();
    const imageByName = new Map(ingredientRows.map(row => [String(row.name || '').toLowerCase(), row.image_path || null]));
    return catalog.map(item => {
        const imagePath = imageByName.get(String(item.name).toLowerCase()) || null;
        return {
            name: item.name,
            unit_price: item.unit_price,
            image_url: imagePath ? `/crafts/images/${imagePath}` : null,
        };
    });
}

function normalizeAdvanceParticipants(participants = []) {
    const seenParticipants = new Set();
    const normalized = [];
    for (const p of (Array.isArray(participants) ? participants : []).slice(0, 3)) {
        const userName = String(p.user_name || p.name || '').trim();
        if (!userName) continue;
        const userId = String(p.user_id || '').trim() || null;
        const uniqueKey = (userId || userName).toLowerCase();
        if (seenParticipants.has(uniqueKey)) {
            throw new Error('Chaque participant ne peut être choisi qu’une seule fois');
        }
        seenParticipants.add(uniqueKey);
        const amountContributed = cleanMoney(p.amount_contributed);
        const amountRecovered = cleanMoney(p.amount_recovered);
        normalized.push({
            user_id: userId,
            user_name: userName,
            amount_contributed: amountContributed,
            amount_recovered: amountRecovered,
            amount_remaining: Math.max(0, amountContributed - amountRecovered),
            amount_to_compensate_next_order: cleanMoney(p.amount_to_compensate_next_order),
            note: String(p.note || '').trim() || null,
        });
    }
    return normalized;
}

function calculateAdvanceTotals(payload, participants, legacyRecoveredAmount = 0, items = []) {
    const contributedTotal = participants.reduce((sum, p) => sum + p.amount_contributed, 0);
    const itemsTotal = items.reduce((sum, item) => sum + item.line_total, 0);
    const totalAmount = itemsTotal || cleanMoney(payload.total_amount) || contributedTotal;
    const recoveredFromPayload = Object.prototype.hasOwnProperty.call(payload, 'recovered_amount')
        ? cleanMoney(payload.recovered_amount)
        : cleanMoney(legacyRecoveredAmount);
    const recoveredFromParticipants = participants.reduce((sum, p) => sum + p.amount_recovered, 0);
    const recoveredAmount = recoveredFromPayload || recoveredFromParticipants;
    return {
        total_amount: totalAmount,
        recovered_amount: recoveredAmount,
        remaining_amount: Math.max(0, totalAmount - recoveredAmount),
    };
}

function hydrateOrderAdvance(order, participants = [], repayments = [], items = []) {
    const totalAmount = cleanMoney(order.total_amount);
    const legacyRecoveredAmount = cleanMoney(order.recovered_amount);
    const detailedRepayments = Array.isArray(repayments) ? repayments : [];
    const hasDetailedRepayments = detailedRepayments.length > 0;
    const repaymentByParticipant = new Map();
    const repaymentByUser = new Map();

    for (const repayment of detailedRepayments) {
        const amount = cleanMoney(repayment.amount);
        if (repayment.participant_id) {
            const key = String(repayment.participant_id);
            repaymentByParticipant.set(key, (repaymentByParticipant.get(key) || 0) + amount);
        }
        if (repayment.user_id) {
            const key = String(repayment.user_id);
            repaymentByUser.set(key, (repaymentByUser.get(key) || 0) + amount);
        }
    }

    const hydratedParticipants = participants.map(participant => {
        let recovered = cleanMoney(participant.amount_recovered);
        if (hasDetailedRepayments) {
            recovered = repaymentByParticipant.get(String(participant.id)) || repaymentByUser.get(String(participant.user_id)) || 0;
        } else if (participants.length === 1 && legacyRecoveredAmount > recovered) {
            recovered = legacyRecoveredAmount;
        }
        const contributed = cleanMoney(participant.amount_contributed);
        return {
            ...participant,
            amount_contributed: contributed,
            amount_recovered: recovered,
            amount_remaining: Math.max(0, contributed - recovered),
        };
    });

    let recoveredAmount = hasDetailedRepayments
        ? detailedRepayments.reduce((sum, repayment) => sum + cleanMoney(repayment.amount), 0)
        : (legacyRecoveredAmount || hydratedParticipants.reduce((sum, participant) => sum + cleanMoney(participant.amount_recovered), 0));
    let remainingAmount = Math.max(0, totalAmount - recoveredAmount);

    if (order.status === 'settled') {
        recoveredAmount = totalAmount;
        remainingAmount = 0;
        for (const participant of hydratedParticipants) {
            participant.amount_recovered = participant.amount_contributed;
            participant.amount_remaining = 0;
        }
    }

    return {
        ...order,
        title: order.title || orderAdvanceTitle(order.order_date),
        total_amount: totalAmount,
        recovered_amount: recoveredAmount,
        legacy_recovered_amount: legacyRecoveredAmount,
        remaining_amount: remainingAmount,
        status: order.status === 'settled' || remainingAmount <= 0 ? 'settled' : (recoveredAmount > 0 ? 'partial' : 'open'),
        has_detailed_repayments: hasDetailedRepayments,
        items: Array.isArray(items) ? items : [],
        participants: hydratedParticipants,
        repayments: detailedRepayments,
    };
}

function getOrderAdvances() {
            const orders = db.prepare('SELECT * FROM order_advances ORDER BY status ASC, order_date DESC, id DESC').all();
        const getParticipants = db.prepare('SELECT * FROM order_advance_participants WHERE order_id = ? ORDER BY id ASC');
        const getRepayments = db.prepare('SELECT * FROM order_advance_repayments WHERE order_id = ? ORDER BY repayment_date DESC, id DESC');
        const getItems = db.prepare('SELECT * FROM order_advance_items WHERE order_id = ? ORDER BY id ASC');
        return orders.map(order => hydrateOrderAdvance(order, getParticipants.all(order.id), getRepayments.all(order.id), getItems.all(order.id)));
}

function getOrderAdvanceById(id) {
    return getOrderAdvances().find(order => Number(order.id) === Number(id)) || null;
}

function buildOrderDiscordMessage(order) {
    const total = cleanMoney(order.total_amount);
    const recovered = cleanMoney(order.recovered_amount);
    const remaining = Math.max(0, total - recovered);
    const percent = total > 0 ? Math.round((recovered / total) * 100) : 0;
    const items = (order.items || []).length
        ? order.items.map(item => `• ${item.quantity.toLocaleString('fr-FR')} ${item.ingredient_name} (× ${formatMoney(item.unit_price)} = ${formatMoney(item.line_total)})`).join('\n')
        : '• Aucun ingrédient renseigné';
    const participants = (order.participants || []).length
        ? order.participants.map(participant => `• ${participant.user_name} : ${formatMoney(participant.amount_contributed)}`).join('\n')
        : '• Aucun participant renseigné';
    const updatedAt = new Date().toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        dateStyle: 'short',
        timeStyle: 'short',
    });
    const lines = [
        '🛒 **Nouvelle commande passée**',
        '',
        '📦 **Contenu :**',
        items,
        '',
        `💰 **Total : ${formatMoney(total)}**`,
        '',
        '👥 **Avancé par :**',
        participants,
        '',
        `💸 **Remboursé : ${formatMoney(recovered)} / ${formatMoney(total)} (${percent} %)**`,
        `🔄 Reste : ${formatMoney(remaining)}`,
        '',
        `⏱ Dernière mise à jour : ${updatedAt}`,
        order.status === 'settled' ? '✅ **Commande soldée**' : '',
    ];
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
}

async function fetchOrderDiscordChannel(channelId = ORDER_DISCORD_CHANNEL_ID) {
    const botClient = typeof getBotClient === 'function' ? getBotClient() : null;
    if (!botClient?.channels) throw new Error('Bot Discord indisponible');
    return botClient.channels.fetch(channelId);
}

async function publishOrderAdvance(orderId) {
    const order = getOrderAdvanceById(orderId);
    if (!order) throw new Error('Commande introuvable');
    if (order.discord_message_id) throw new Error('Commande déjà publiée');
    const channel = await fetchOrderDiscordChannel(ORDER_DISCORD_CHANNEL_ID);
    const content = buildOrderDiscordMessage(order);
    const message = await channel.send({ content });
    db.prepare(`UPDATE order_advances SET discord_message_id = ?, discord_channel_id = ?, published_at = strftime('%s','now'), updated_at = strftime('%s','now') WHERE id = ?`)
        .run(message.id, ORDER_DISCORD_CHANNEL_ID, orderId);
    return { messageId: message.id, content };
}

async function refreshOrderDiscordMessage(orderId) {
    const order = getOrderAdvanceById(orderId);
    if (!order?.discord_message_id) return false;
    try {
        const channel = await fetchOrderDiscordChannel(order.discord_channel_id || ORDER_DISCORD_CHANNEL_ID);
        const message = await channel.messages.fetch(order.discord_message_id);
        await message.edit({ content: buildOrderDiscordMessage(order) });
        return true;
    } catch (e) {
        log.warn(`[order-advances] Message Discord commande ${orderId} introuvable/non éditable: ${e.message}`);
        return false;
    }
}

function refreshOrderDiscordMessageInBackground(orderId) {
    setTimeout(() => {
        refreshOrderDiscordMessage(orderId).catch(e => log.warn(`[order-advances] Refresh Discord impossible pour ${orderId}: ${e.message}`));
    }, 0);
}

function upsertOrderAdvance(payload, id = null) {
    const orderIdForUpdate = Number(id);
    let existingOrder = null;
    if (orderIdForUpdate) {
        existingOrder = db.prepare('SELECT * FROM order_advances WHERE id = ?').get(orderIdForUpdate);
        if (!existingOrder) throw new Error('Commande introuvable');
    }
    const participants = normalizeAdvanceParticipants(payload.participants);
    if (!participants.length) throw new Error('Ajoute au moins un participant');
    const items = normalizeOrderItems(payload.items);
    const now = Math.floor(Date.now() / 1000);
    const orderDate = String(payload.order_date || '').trim() || null;
    if (!orderDate) throw new Error('Date de commande requise');
    const title = String(payload.title || existingOrder?.title || orderAdvanceTitle(orderDate)).trim();
    const legacyRecovered = existingOrder && !Object.prototype.hasOwnProperty.call(payload, 'recovered_amount')
        ? existingOrder.recovered_amount
        : payload.recovered_amount;
    const totals = calculateAdvanceTotals(payload, participants, legacyRecovered, items);
    const note = Object.prototype.hasOwnProperty.call(payload, 'note')
        ? (String(payload.note || '').trim() || null)
        : (existingOrder?.note || null);
    const requestedStatus = String(payload.status || 'open').trim();
    const status = requestedStatus === 'settled' ? 'settled' : (totals.remaining_amount <= 0 ? 'settled' : 'open');

    const tx = db.transaction(() => {
        let orderId = orderIdForUpdate;
        if (orderId) {
            db.prepare(`UPDATE order_advances SET title = ?, order_date = ?, total_amount = ?, recovered_amount = ?, remaining_amount = ?, note = ?, status = ?, updated_at = ? WHERE id = ?`)
                .run(title, orderDate, totals.total_amount, totals.recovered_amount, totals.remaining_amount, note, status, now, orderId);
            db.prepare('DELETE FROM order_advance_participants WHERE order_id = ?').run(orderId);
            db.prepare('DELETE FROM order_advance_items WHERE order_id = ?').run(orderId);
        } else {
            const r = db.prepare(`INSERT INTO order_advances (title, order_date, total_amount, recovered_amount, remaining_amount, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(title, orderDate, totals.total_amount, totals.recovered_amount, totals.remaining_amount, note, status, now, now);
            orderId = r.lastInsertRowid;
        }
        const stmt = db.prepare(`INSERT INTO order_advance_participants (order_id, user_id, user_name, amount_contributed, amount_recovered, amount_remaining, amount_to_compensate_next_order, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const p of participants) {
            stmt.run(orderId, p.user_id, p.user_name, p.amount_contributed, p.amount_recovered, p.amount_remaining, p.amount_to_compensate_next_order, p.note, now, now);
        }
        const itemStmt = db.prepare(`INSERT INTO order_advance_items (order_id, ingredient_name, unit_price, quantity, line_total, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
        for (const item of items) {
            itemStmt.run(orderId, item.ingredient_name, item.unit_price, item.quantity, item.line_total, now);
        }
        return orderId;
    });
    const savedId = tx();
    if (existingOrder?.discord_message_id) refreshOrderDiscordMessageInBackground(savedId);
    return savedId;
}

function deleteOrderAdvance(id) {
            db.prepare('DELETE FROM order_advance_repayments WHERE order_id = ?').run(id);
        db.prepare('DELETE FROM order_advance_participants WHERE order_id = ?').run(id);
        db.prepare('DELETE FROM order_advance_items WHERE order_id = ?').run(id);
        db.prepare('DELETE FROM order_advances WHERE id = ?').run(id);
        return;
}

function settleOrderAdvance(id) {
    const now = Math.floor(Date.now() / 1000);
            const order = db.prepare('SELECT * FROM order_advances WHERE id = ?').get(id);
        if (!order) throw new Error('Commande introuvable');
        db.prepare(`UPDATE order_advances SET recovered_amount = total_amount, remaining_amount = 0, status = 'settled', updated_at = ? WHERE id = ?`).run(now, id);
        db.prepare(`UPDATE order_advance_participants SET amount_recovered = amount_contributed, amount_remaining = 0, updated_at = ? WHERE order_id = ?`).run(now, id);
        refreshOrderDiscordMessageInBackground(id);
        return;
}

function normalizeOrderAdvanceRepayment(orderId, payload) {
    const participantId = parseInt(payload.participant_id, 10);
    const amount = cleanMoney(payload.amount);
    const repaymentDate = String(payload.repayment_date || todayIsoDate()).trim();
    if (!orderId) throw new Error('Commande introuvable');
    if (!participantId) throw new Error('Participant obligatoire');
    if (!amount) throw new Error('Montant récupéré obligatoire');
    if (!repaymentDate) throw new Error('Date de remboursement obligatoire');

    let participant;
            participant = db.prepare('SELECT * FROM order_advance_participants WHERE id = ? AND order_id = ?').get(participantId, orderId);

    if (!participant) throw new Error('Participant introuvable pour cette commande');

    return {
        order_id: orderId,
        participant_id: participantId,
        user_id: participant.user_id || null,
        user_name: participant.user_name,
        amount,
        reason: String(payload.reason || '').trim() || null,
        weapon_name: String(payload.weapon_name || '').trim() || null,
        repayment_date: repaymentDate,
    };
}

function saveOrderAdvanceRepayment(orderId, payload, repaymentId = null) {
    const normalized = normalizeOrderAdvanceRepayment(orderId, payload);
    const now = Math.floor(Date.now() / 1000);
            if (repaymentId) {
            const existing = db.prepare('SELECT * FROM order_advance_repayments WHERE id = ? AND order_id = ?').get(repaymentId, orderId);
            if (!existing) throw new Error('Remboursement introuvable');
            db.prepare(`UPDATE order_advance_repayments SET participant_id = ?, user_id = ?, user_name = ?, amount = ?, reason = ?, weapon_name = ?, repayment_date = ?, updated_at = ? WHERE id = ? AND order_id = ?`)
                .run(normalized.participant_id, normalized.user_id, normalized.user_name, normalized.amount, normalized.reason, normalized.weapon_name, normalized.repayment_date, now, repaymentId, orderId);
            refreshOrderDiscordMessageInBackground(orderId);
            return repaymentId;
        }
        const result = db.prepare(`INSERT INTO order_advance_repayments (order_id, participant_id, user_id, user_name, amount, reason, weapon_name, repayment_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(orderId, normalized.participant_id, normalized.user_id, normalized.user_name, normalized.amount, normalized.reason, normalized.weapon_name, normalized.repayment_date, now, now);
        refreshOrderDiscordMessageInBackground(orderId);
        return result.lastInsertRowid;
}

function deleteOrderAdvanceRepayment(orderId, repaymentId) {
            const result = db.prepare('DELETE FROM order_advance_repayments WHERE id = ? AND order_id = ?').run(repaymentId, orderId);
        if (!result.changes) throw new Error('Remboursement introuvable');
        refreshOrderDiscordMessageInBackground(orderId);
        return;
}



    return {
        getOrderAdvances,
        upsertOrderAdvance,
        deleteOrderAdvance,
        settleOrderAdvance,
        saveOrderAdvanceRepayment,
        deleteOrderAdvanceRepayment,
        getOrderAdvanceCatalog,
        publishOrderAdvance,
        refreshOrderDiscordMessage,
    };
}

module.exports = {
    createOrderAdvanceService,
};
