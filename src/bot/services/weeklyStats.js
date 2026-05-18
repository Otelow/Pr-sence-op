// QUICK WINS 5 18/05/2026 — bilan hebdomadaire Discord configurable
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const config = require('../../shared/config');
const { createConnection } = require('../../shared/database');
const { audit } = require('../../shared/auditLog');
const log = require('../../shared/logger');

function getWeekRangeParis() {
    const now = new Date();
    const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const day = parisNow.getDay() || 7;
    const monday = new Date(parisNow);
    monday.setDate(parisNow.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return {
        start: Math.floor(monday.getTime() / 1000),
        end: Math.floor(sunday.getTime() / 1000),
        label: `${monday.toLocaleDateString('fr-FR')} → ${sunday.toLocaleDateString('fr-FR')}`,
    };
}

function countSafe(db, sql, params = []) {
    try {
        return Number(db.prepare(sql).get(...params)?.c) || 0;
    } catch {
        return 0;
    }
}

function collectWeeklyStats() {
    const { start, end, label } = getWeekRangeParis();
    const db = createConnection(config.paths.database);
    try {
        const stats = {
            range: label,
            presence_reactions: countSafe(db, `
                SELECT COUNT(*) as c FROM audit_log
                WHERE action LIKE 'presence.%' AND created_at BETWEEN ? AND ?
            `, [start, end]),
            crafts_validated: countSafe(db, `
                SELECT COUNT(*) as c FROM craft_requests
                WHERE (status IN ('crafted', 'completed') OR crafted = 1)
                  AND COALESCE(craft_date, created_at) BETWEEN ? AND ?
            `, [start, end]),
            weapons_sold: countSafe(db, `
                SELECT COUNT(*) as c FROM my_weapons
                WHERE is_sold = 1 AND COALESCE(sold_at, created_at) BETWEEN ? AND ?
            `, [start, end]),
            orders_created: countSafe(db, `
                SELECT COUNT(*) as c FROM order_advances
                WHERE created_at BETWEEN ? AND ?
            `, [start, end]),
            sanctions_added: countSafe(db, `
                SELECT COUNT(*) as c FROM audit_log
                WHERE action = 'sanction.add' AND created_at BETWEEN ? AND ?
            `, [start, end]),
            top_admins: [],
        };
        try {
            stats.top_admins = db.prepare(`
                SELECT COALESCE(user_name, 'Inconnu') as user_name, COUNT(*) as actions
                FROM audit_log
                WHERE created_at BETWEEN ? AND ? AND user_id IS NOT NULL
                GROUP BY user_id
                ORDER BY actions DESC
                LIMIT 3
            `).all(start, end);
        } catch {}
        return stats;
    } finally {
        try { db.close(); } catch {}
    }
}

function buildWeeklyStatsEmbed(stats) {
    const total = stats.presence_reactions + stats.crafts_validated + stats.weapons_sold
        + stats.orders_created + stats.sanctions_added;
    const description = total === 0
        ? 'Semaine calme, à la semaine prochaine !'
        : [
            `**Réactions présence :** ${stats.presence_reactions}`,
            `**Crafts validés :** ${stats.crafts_validated}`,
            `**Armes vendues :** ${stats.weapons_sold}`,
            `**Commandes créées :** ${stats.orders_created}`,
            `**Sanctions ajoutées :** ${stats.sanctions_added}`,
        ].join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`📊 Bilan de la semaine — ${stats.range}`)
        .setColor(0xff8a00)
        .setDescription(description)
        .setFooter({ text: 'Bilan automatique tous les dimanches 19h' })
        .setTimestamp();

    if (stats.top_admins.length) {
        stats.top_admins.forEach((admin, index) => {
            embed.addFields({
                name: `#${index + 1} ${admin.user_name}`,
                value: `${admin.actions} action(s)`,
                inline: true,
            });
        });
    }
    return embed;
}

async function postWeeklyStats(botClient) {
    const channelId = config.discord.weeklyStatsChannelId;
    if (!channelId) {
        log.info('📊 stats hebdo skip — WEEKLY_STATS_CHANNEL_ID non configuré');
        return { skipped: true, reason: 'missing_channel' };
    }
    const channel = await botClient.channels.fetch(channelId);
    const stats = collectWeeklyStats();
    await channel.send({ embeds: [buildWeeklyStatsEmbed(stats)] });
    audit(null, 'weekly.stats.published', {
        target_type: 'discord_channel',
        target_id: channelId,
        details: { stats },
    });
    log.info({ channelId }, '✅ Stats hebdo publiées');
    return { skipped: false, stats };
}

function scheduleWeeklyStats(botClient) {
    cron.schedule('0 19 * * 0', () => {
        postWeeklyStats(botClient).catch(e => log.warn({ err: e.message }, 'weekly stats échoué'));
    }, { timezone: 'Europe/Paris' });
}

module.exports = {
    postWeeklyStats,
    scheduleWeeklyStats,
    collectWeeklyStats,
};
