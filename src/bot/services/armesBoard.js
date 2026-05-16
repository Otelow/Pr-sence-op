// BOARD ARMES 17/05/2026 — messages live armes en vente/vendues
const { EmbedBuilder } = require('discord.js');
const log = require('../../shared/logger');
const { createConnection } = require('../../shared/database');
const { loadState, saveState } = require('./state');

const BOARD_CHANNEL_ID = '1505212389203644447';
const STATE_KEY = 'armes_board';
const MAX_DESCRIPTION = 3900;
const MAX_EMBEDS_PER_MESSAGE = 10;

let db = null;
let isRefreshing = false;
let refreshQueued = false;

function getDb() {
    if (!db) db = createConnection();
    return db;
}

function formatMoney(value) {
    const amount = Number(value) || 0;
    return `${amount.toLocaleString('fr-FR')} $`;
}

function formatDateParis() {
    return new Date().toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function truncatePad(value, width, align = 'left') {
    const raw = String(value || '-').replace(/\s+/g, ' ').trim();
    const shortened = raw.length > width ? `${raw.slice(0, Math.max(0, width - 1))}…` : raw;
    return align === 'right' ? shortened.padStart(width, ' ') : shortened.padEnd(width, ' ');
}

function salePrice(row) {
    return Number(row.sold_price ?? row.asking_price ?? row.min_price ?? 0) || 0;
}

function loadWeapons() {
    const rows = getDb().prepare(`
        SELECT *
        FROM my_weapons
        ORDER BY COALESCE(sold_price, asking_price, min_price, 0) DESC, created_at DESC, id DESC
    `).all();

    const batchCounts = new Map();
    for (const row of rows) {
        const key = row.batch_id || `single-${row.id}`;
        const current = batchCounts.get(key) || { total: 0, sold: 0, available: 0 };
        current.total += 1;
        if (row.is_sold) current.sold += 1;
        else current.available += 1;
        batchCounts.set(key, current);
    }

    return rows.map(row => {
        const counts = batchCounts.get(row.batch_id || `single-${row.id}`) || { total: 1, sold: row.is_sold ? 1 : 0, available: row.is_sold ? 0 : 1 };
        return {
            ...row,
            board_price: salePrice(row),
            board_quantity: row.is_sold ? `${counts.sold}/${counts.total}` : `${counts.available}/${counts.total}`,
            board_serial: row.serial_number || 'N/A',
        };
    });
}

function buildOnSaleLine(row) {
    return [
        truncatePad(row.weapon_name, 25),
        truncatePad(row.user_name, 18),
        truncatePad(row.board_quantity, 5),
        truncatePad(row.board_serial, 6),
        truncatePad(formatMoney(row.board_price), 13, 'right'),
    ].join(' ');
}

function buildSoldLine(row) {
    return [
        truncatePad(row.weapon_name, 22),
        truncatePad(row.sold_by_name || row.user_name, 18),
        truncatePad(row.board_quantity, 5),
        truncatePad(row.board_serial, 6),
        truncatePad(formatMoney(row.board_price), 13, 'right'),
        truncatePad(row.sold_to || '-', 18),
    ].join(' ');
}

function chunkLines(header, separator, lines) {
    const chunks = [];
    let current = [header, separator];

    for (const line of lines) {
        const next = [...current, line];
        const candidate = `\`\`\`\n${next.join('\n')}\n\`\`\``;
        if (candidate.length > MAX_DESCRIPTION && current.length > 2) {
            chunks.push(current);
            current = [header, separator, line];
        } else {
            current = next;
        }
    }

    if (current.length === 2) current.push('Aucune arme à afficher.');
    chunks.push(current);
    return chunks;
}

function buildEmbeds({ title, color, rows, lineBuilder, header, separator }) {
    const sorted = [...rows].sort((a, b) => (b.board_price - a.board_price) || ((b.created_at || 0) - (a.created_at || 0)));
    const lines = sorted.map(lineBuilder);
    const chunks = chunkLines(header, separator, lines);
    const updatedAt = formatDateParis();

    return chunks.map((chunk, index) => {
        const total = chunks.length;
        const pageTitle = total > 1
            ? title.replace('{count}', `${rows.length} (${index + 1}/${total})`)
            : title.replace('{count}', String(rows.length));

        return new EmbedBuilder()
            .setTitle(pageTitle)
            .setColor(color)
            .setDescription(`\`\`\`\n${chunk.join('\n')}\n\`\`\``)
            .setFooter({ text: `Mise à jour : ${updatedAt} — Triées du + cher au - cher` });
    });
}

function splitEmbedsIntoMessages(embeds) {
    const messages = [];
    for (let i = 0; i < embeds.length; i += MAX_EMBEDS_PER_MESSAGE) {
        messages.push(embeds.slice(i, i + MAX_EMBEDS_PER_MESSAGE));
    }
    return messages;
}

async function editOrCreateMessage(channel, messageId, embeds) {
    if (messageId) {
        try {
            const message = await channel.messages.fetch(messageId);
            await message.edit({ embeds, allowedMentions: { parse: [] } });
            return message.id;
        } catch (e) {
            log.warn({ err: e.message, messageId }, 'board armes message introuvable, recréation');
        }
    }

    const message = await channel.send({ embeds, allowedMentions: { parse: [] } });
    return message.id;
}

async function syncCategoryMessages(channel, storedIds, messageEmbeds) {
    const nextIds = [];
    const previousIds = Array.isArray(storedIds) ? storedIds : [];

    for (let i = 0; i < messageEmbeds.length; i += 1) {
        const id = await editOrCreateMessage(channel, previousIds[i], messageEmbeds[i]);
        nextIds.push(id);
    }

    const extraIds = previousIds.slice(messageEmbeds.length);
    for (const id of extraIds) {
        try {
            const message = await channel.messages.fetch(id);
            await message.delete();
        } catch (e) {
            log.warn({ err: e.message, messageId: id }, 'board armes message excédentaire déjà absent');
        }
    }

    return nextIds;
}

async function runRefresh(botClient) {
    if (!botClient?.isReady?.()) {
        throw new Error('bot Discord non prêt');
    }

    const state = loadState(STATE_KEY, {}) || {};
    const channel = await botClient.channels.fetch(BOARD_CHANNEL_ID);
    if (!channel) throw new Error(`salon ${BOARD_CHANNEL_ID} introuvable`);

    const weapons = loadWeapons();
    const onSale = weapons.filter(row => !row.is_sold);
    const sold = weapons.filter(row => row.is_sold);

    const onSaleEmbeds = buildEmbeds({
        title: '🟢 ARMES EN VENTE — {count}',
        color: 0x4ade80,
        rows: onSale,
        lineBuilder: buildOnSaleLine,
        header: 'Arme                      Vendeur            Qté   Série  Prix',
        separator: '======================================================================',
    });
    const soldEmbeds = buildEmbeds({
        title: '🔴 ARMES VENDUES — {count}',
        color: 0xef4444,
        rows: sold,
        lineBuilder: buildSoldLine,
        header: 'Arme                   Vendeur            Qté   Série  Prix          Vendu à',
        separator: '================================================================================',
    });

    const nextOnSaleMessageIds = await syncCategoryMessages(channel, state.onSaleMessageIds, splitEmbedsIntoMessages(onSaleEmbeds));
    saveState(STATE_KEY, {
        ...state,
        channelId: BOARD_CHANNEL_ID,
        onSaleMessageIds: nextOnSaleMessageIds,
        lastUpdate: Math.floor(Date.now() / 1000),
    });

    const nextSoldMessageIds = await syncCategoryMessages(channel, state.soldMessageIds, splitEmbedsIntoMessages(soldEmbeds));
    const nextState = {
        channelId: BOARD_CHANNEL_ID,
        onSaleMessageIds: nextOnSaleMessageIds,
        soldMessageIds: nextSoldMessageIds,
        lastUpdate: Math.floor(Date.now() / 1000),
    };

    saveState(STATE_KEY, nextState);
    log.info({ onSale: onSale.length, sold: sold.length }, '✅ Board armes rafraîchi');
}

async function refreshArmesBoard(botClient) {
    if (isRefreshing) {
        refreshQueued = true;
        return;
    }

    isRefreshing = true;
    try {
        do {
            refreshQueued = false;
            await runRefresh(botClient);
        } while (refreshQueued);
    } finally {
        isRefreshing = false;
    }
}

async function initArmesBoard(botClient) {
    await refreshArmesBoard(botClient);
}

module.exports = {
    BOARD_CHANNEL_ID,
    initArmesBoard,
    refreshArmesBoard,
};
