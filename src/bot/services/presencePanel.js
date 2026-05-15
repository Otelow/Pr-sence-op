// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
// STABILISATION 15/05/2026 — corrections runtime post-audit
// MODIFIE CHANTIER 6 - 14/05/2026 - cache salon absence et embeds panneau presence externalises

const { EmbedBuilder } = require('discord.js');

function createPresencePanelService(deps) {
    const {
        CONFIG,
        client,
        getPresenceData,
        getPresence2Data,
        reactionsOP1,
        reactionsOP2,
        getAbsenceTracking,
        getAbsentUsersToday,
        refreshAbsencePanel,
    } = deps;

    let absenceSalonCache = {
        validAbsences: new Set(),
        invalidAbsences: new Set(),
        validAbsenceNames: [],
        invalidAbsenceNames: [],
    };
    let absenceCacheUpdating = null;
    let absenceCacheUpdateSeq = 0;
    let absenceCacheRefreshTimeout = null;

    async function updateAbsenceSalonCache({ force = false } = {}) {
        if (absenceCacheUpdating && !force) {
            await absenceCacheUpdating;
            return absenceSalonCache;
        }
        const seq = ++absenceCacheUpdateSeq;
        const work = (async () => {
            try {
                const nextCache = await getAbsentUsersToday();
                if (seq === absenceCacheUpdateSeq) {
                    absenceSalonCache = nextCache;
                }
            } catch (e) {
                log.warn('⚠️ Cache absences salon non mis à jour:', e.message);
            }
        })();
        absenceCacheUpdating = work;
        try {
            await work;
        } finally {
            if (absenceCacheUpdating === work) absenceCacheUpdating = null;
        }
        return absenceSalonCache;
    }

    function scheduleAbsenceSalonCacheUpdate(reason = 'event') {
        if (absenceCacheRefreshTimeout) clearTimeout(absenceCacheRefreshTimeout);
        absenceCacheRefreshTimeout = setTimeout(() => {
            absenceCacheRefreshTimeout = null;
            updateAbsenceSalonCache({ force: true })
                .then(() => refreshAbsencePanel?.())
                .catch(e => log.warn(`⚠️ Refresh cache absences (${reason}) échoué:`, e.message));
        }, 500);
    }

    function handleAbsenceSalonCacheEvent(message, reason) {
        const channelId = message?.channelId || message?.channel?.id;
        if (channelId !== CONFIG.CHANNELS.ABSENCE) return;
        log.info(`📋 Salon absences modifié (${reason}) → cache à recalculer`);
        scheduleAbsenceSalonCacheUpdate(reason);
    }

    function buildAbsencePanelEmbeds() {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
        const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const role = guild ? guild.roles.cache.get(CONFIG.ROLES.MEMBRE_1) : null;

        const embeds = [];
        const header = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('📋 Suivi Présence OP')
            .setDescription(`📅 **${dateStr}** • ⏰ **${timeStr}**`)
            .setFooter({ text: 'Mise à jour auto toutes les 30s • Tape /absence pour rafraîchir' });
        embeds.push(header);

        embeds.push(buildPresenceEmbed('1ère Présence OP', getPresenceData(), reactionsOP1, role, absenceSalonCache, 0x57F287));
        embeds.push(buildPresenceEmbed('2ème Présence OP', getPresence2Data(), reactionsOP2, role, absenceSalonCache, 0x5865F2));
        embeds.push(buildAbsenceSalonEmbed(absenceSalonCache));
        embeds.push(buildWeeklySummaryEmbed());

        return embeds;
    }

    function buildAbsencePanelPlaceholderEmbed(index = 1, total = 5) {
        return new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle(`📋 Suivi Présence OP — chargement ${index}/${total}`)
            .setDescription('⏳ Construction du panneau absence en cours...')
            .setFooter({ text: 'Le panneau se remplit automatiquement dans quelques secondes.' });
    }

    function buildPresenceEmbed(title, data, reactionMap, role, absData, color) {
        const embed = new EmbedBuilder().setTitle(`📋 ${title}`).setColor(color);

        if (!data.active || !data.messageId) {
            return embed.setDescription('⚠️ *Pas encore lancée*').setColor(0x95A5A6);
        }

        if (data.terminated) {
            return embed.setDescription('⏹️ *Terminée*').setColor(0x95A5A6);
        }

        if (!role) return embed.setDescription('❌ Rôle introuvable');

        const present = [];
        const late = [];
        const absentReact = [];
        const absentValid = [];
        const noReaction = [];

        for (const [, member] of role.members) {
            if (member.user.bot) continue;
            if (member.roles.cache.has(CONFIG.ROLES.EXCLUDED_ROLE)) continue;

            const name = member.nickname || member.user.username;
            const reaction = reactionMap.get(member.id);

            if (reaction === 'check') present.push(name);
            else if (reaction === 'retard') late.push(name);
            else if (reaction === 'no') absentReact.push(name);
            else if (absData.validAbsences.has(member.id)) absentValid.push(name);
            else noReaction.push(name);
        }

        const total = present.length + late.length + absentReact.length + absentValid.length + noReaction.length;

        const formatList = (list) => {
            if (list.length === 0) return '*Aucun*';
            const text = list.map(name => `• ${name}`).join('\n');
            if (text.length <= 1024) return text;

            const truncated = [];
            let len = 0;
            for (const name of list) {
                const line = `• ${name}\n`;
                if (len + line.length > 950) {
                    truncated.push(`*...et ${list.length - truncated.length} autres*`);
                    break;
                }
                truncated.push(line.trim());
                len += line.length;
            }
            return truncated.join('\n');
        };

        embed.setDescription(`👥 **${total}** membres au total`);
        embed.addFields(
            { name: `✅ Présents — ${present.length}`, value: formatList(present), inline: false },
            { name: `⏰ Retards — ${late.length}`, value: formatList(late), inline: false },
            { name: `❌ Absents non justifiés — ${absentReact.length}`, value: formatList(absentReact), inline: false },
            { name: `📋 Absents justifiés — ${absentValid.length}`, value: formatList(absentValid), inline: false },
            { name: `⚠️ Pas de réaction — ${noReaction.length}`, value: formatList(noReaction), inline: false },
        );

        return embed;
    }

    function buildAbsenceSalonEmbed(data) {
        const embed = new EmbedBuilder().setTitle('📅 Absences posées dans le salon').setColor(0xFEE75C);

        const validNames = data.validAbsenceNames || [];
        const invalidNames = data.invalidAbsenceNames || [];

        if (validNames.length === 0 && invalidNames.length === 0) {
            return embed.setDescription('*Aucune absence posée*');
        }

        const formatList = (list) => list.length === 0 ? '*Aucune*' : list.map(name => `• ${name}`).join('\n');
        embed.addFields(
            { name: `✅ Conformes — ${validNames.length}`, value: formatList(validNames).slice(0, 1024), inline: false },
            { name: `❌ Non conformes — ${invalidNames.length}`, value: formatList(invalidNames).slice(0, 1024), inline: false },
        );

        return embed;
    }

    function buildWeeklySummaryEmbed() {
        const embed = new EmbedBuilder().setTitle('📊 Suivi hebdomadaire — Absences').setColor(0xED4245);
        const absenceTracking = getAbsenceTracking();

        if (absenceTracking.size === 0) {
            return embed.setDescription('✨ *Aucune absence enregistrée cette semaine*').setColor(0x57F287);
        }

        const sorted = [...absenceTracking.entries()].sort((a, b) => b[1].count - a[1].count);
        const consecutive = [];
        const classic = [];

        for (const entry of sorted) {
            const [, data] = entry;
            const consec = getConsecutiveDays(data);
            if (consec >= 2) consecutive.push({ entry, consec });
            else classic.push(entry);
        }

        if (consecutive.length > 0) {
            const lines = [];
            for (const { entry: [, data], consec } of consecutive) {
                lines.push(`**⚠️ ${data.username}** — *${consec} jours consécutifs* (${data.count} total)`);
                if (data.details) {
                    for (const d of data.details) {
                        lines.push(`  ${d.justified ? '✅' : '❌'} ${d.date} • ${d.op}`);
                    }
                }
            }
            embed.addFields({ name: '🚨 Absences consécutives (alerte KP)', value: lines.join('\n').slice(0, 1024), inline: false });
        }

        if (classic.length > 0) {
            const lines = [];
            for (const [, data] of classic) {
                lines.push(`**${data.username}** — ${data.count} absence(s)`);
                if (data.details) {
                    for (const d of data.details) {
                        lines.push(`  ${d.justified ? '✅' : '❌'} ${d.date} • ${d.op}`);
                    }
                }
            }
            embed.addFields({ name: '📋 Absences cette semaine', value: lines.join('\n').slice(0, 1024), inline: false });
        }

        embed.setFooter({ text: '🚨 = 2+ jours consécutifs → KP • Reset : Dimanche 22h00' });
        return embed;
    }

    function getConsecutiveDays(data) {
        if (!data.details || data.details.length === 0) return 0;

        const unjustifiedDates = [...new Set(
            data.details
                .filter(detail => !detail.justified)
                .map(detail => detail.date)
        )];

        if (unjustifiedDates.length === 0) return 0;

        const year = new Date().getFullYear();
        const parsed = unjustifiedDates.map(dateLabel => {
            const [day, month] = dateLabel.split('/').map(Number);
            return new Date(year, month - 1, day);
        }).sort((a, b) => b - a);

        let consecutive = 1;
        for (let i = 0; i < parsed.length - 1; i += 1) {
            const diff = (parsed[i] - parsed[i + 1]) / (1000 * 60 * 60 * 24);
            if (diff === 1) consecutive += 1;
            else break;
        }

        return consecutive;
    }

    return {
        updateAbsenceSalonCache,
        scheduleAbsenceSalonCacheUpdate,
        handleAbsenceSalonCacheEvent,
        buildAbsencePanelEmbeds,
        buildAbsencePanelPlaceholderEmbed,
        getConsecutiveDays,
        getAbsenceSalonCache: () => absenceSalonCache,
    };
}

module.exports = {
    createPresencePanelService,
};
