// STATUT EN COURS 17/05/2026 — statut jaune sur board armes
// BOARD ARMES v2 17/05/2026 — format clean + regroupement
const { EmbedBuilder } = require('discord.js');
const log = require('../../shared/logger');
const { createConnection } = require('../../shared/database');
const { loadState, saveState } = require('./state');

const BOARD_CHANNEL_ID = '1505212389203644447';
const STATE_KEY = 'armes_board';
const MAX_DESCRIPTION = 4096;

let db = null;
let isRefreshing = false;
let refreshQueued = false;

function getDb() {
    if (!db) db = createConnection();
    return db;
}

function cleanText(value, fallback = '—') {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text || fallback;
}

function escapeMarkdown(value) {
    return cleanText(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}

function formatMoney(value) {
    const amount = Number(value) || 0;
    return `${amount.toLocaleString('fr-FR')} $`;
}

function formatDateParis() {
    return new Date().toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        dateStyle: 'short',
        timeStyle: 'short',
    });
}

function salePrice(row) {
    return Number(row.sold_price ?? row.asking_price ?? row.min_price ?? 0) || 0;
}

function shortSerial(value) {
    const serial = String(value ?? '').trim();
    if (!serial) return null;
    return serial.length > 5 ? `${serial.slice(0, 5)}…` : serial;
}

function loadWeapons() {
    return getDb().prepare(`
        SELECT *
        FROM my_weapons
        ORDER BY COALESCE(sold_price, asking_price, min_price, 0) DESC, created_at DESC, id DESC
    `).all().map(row => ({
        ...row,
        board_price: salePrice(row),
    }));
}

function groupWeapons(rows) {
    const groups = new Map();

    for (const row of rows) {
        const key = [
            cleanText(row.weapon_name, '').toLowerCase(),
            cleanText(row.user_name, '').toLowerCase(),
            String(row.board_price),
            cleanText(row.sold_to, '').toLowerCase(),
            row.is_in_progress ? 'in_progress' : 'normal',
        ].join('|');

        if (!groups.has(key)) {
            groups.set(key, {
                name: cleanText(row.weapon_name),
                ownerName: cleanText(row.user_name),
                soldTo: cleanText(row.sold_to, ''),
                unitPrice: row.board_price,
                inProgress: !!row.is_in_progress,
                createdAt: row.created_at || 0,
                count: 0,
                serials: [],
            });
        }

        const group = groups.get(key);
        group.count += 1;
        group.createdAt = Math.max(group.createdAt, row.created_at || 0);
        if (row.serial_number) group.serials.push(String(row.serial_number).trim());
    }

    return [...groups.values()].sort((a, b) => (b.unitPrice - a.unitPrice) || (b.createdAt - a.createdAt));
}

function pluralExemplaires(count) {
    return `${count} exemplaire${count > 1 ? 's' : ''}`;
}

function buildGroupEntry(group, { sold = false } = {}) {
    const name = escapeMarkdown(group.name);
    const status = group.inProgress && !sold ? ' 🟡 EN COURS' : '';
    const owner = escapeMarkdown(group.ownerName);
    const unitPrice = formatMoney(group.unitPrice);
    const total = formatMoney(group.unitPrice * group.count);

    if (group.count > 1) {
        const lines = [
            `**${name}**${status} \`×${group.count}\` — \`${unitPrice} /u\``,
            `${owner} · ${pluralExemplaires(group.count)} · *Total : ${total}*`,
        ];
        if (sold && group.soldTo) lines.push(`🛒 Vendu à **${escapeMarkdown(group.soldTo)}**`);
        return lines.join('\n');
    }

    const details = [owner, pluralExemplaires(1)];
    const serial = shortSerial(group.serials[0]);
    if (serial) details.push(`Série \`${escapeMarkdown(serial)}\``);

    const lines = [
        `**${name}**${status} — \`${unitPrice}\``,
        details.join(' · '),
    ];
    if (sold && group.soldTo) lines.push(`🛒 Vendu à **${escapeMarkdown(group.soldTo)}**`);
    return lines.join('\n');
}

function fitDescription(entries) {
    if (!entries.length) return { description: '_Aucune arme à afficher._', hidden: 0 };

    let description = '';
    for (let i = 0; i < entries.length; i += 1) {
        const next = description ? `${description}\n\n${entries[i]}` : entries[i];
        const hiddenAfterThis = entries.length - i - 1;
        const suffix = hiddenAfterThis > 0 ? `\n\n*… +${hiddenAfterThis} autres groupes non affichés*` : '';
        if ((next + suffix).length > MAX_DESCRIPTION) {
            return {
                description: `${description}\n\n*… +${entries.length - i} autres groupes non affichés*`.trim(),
                hidden: entries.length - i,
            };
        }
        description = next;
    }

    return { description, hidden: 0 };
}

function buildCategoryEmbed({ title, color, rows, sold = false }) {
    const groups = groupWeapons(rows);
    const entries = groups.map(group => buildGroupEntry(group, { sold }));
    const { description, hidden } = fitDescription(entries);
    if (hidden > 0) log.warn({ hidden, title }, 'board armes description tronquée');

    return new EmbedBuilder()
        .setTitle(title.replace('{count}', String(groups.length)))
        .setColor(color)
        .setDescription(description)
        .setFooter({ text: `Mise à jour : ${formatDateParis()}` });
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

    const onSaleEmbeds = [buildCategoryEmbed({
        title: '🟢 ARMES EN VENTE — {count}',
        color: 0x1D9E75,
        rows: onSale,
        sold: false,
    })];
    const soldEmbeds = [buildCategoryEmbed({
        title: '🔴 ARMES VENDUES — {count}',
        color: 0xA32D2D,
        rows: sold,
        sold: true,
    })];

    const nextOnSaleMessageIds = await syncCategoryMessages(channel, state.onSaleMessageIds, [onSaleEmbeds]);
    saveState(STATE_KEY, {
        ...state,
        channelId: BOARD_CHANNEL_ID,
        onSaleMessageIds: nextOnSaleMessageIds,
        lastUpdate: Math.floor(Date.now() / 1000),
    });

    const nextSoldMessageIds = await syncCategoryMessages(channel, state.soldMessageIds, [soldEmbeds]);
    saveState(STATE_KEY, {
        channelId: BOARD_CHANNEL_ID,
        onSaleMessageIds: nextOnSaleMessageIds,
        soldMessageIds: nextSoldMessageIds,
        lastUpdate: Math.floor(Date.now() / 1000),
    });

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
