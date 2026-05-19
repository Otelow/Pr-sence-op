// FIX PRÉSENCE 18/05/2026 — 3 bugs classification corrigés
// DÉCROCHÉS OP 18/05/2026 — section décrochage entre 1ère et 2ème
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes présence et statistiques isolées

// FINAL POST-STAB F 17/05/2026 — cache membres Discord côté serveur
const { getCachedMembers } = require('../services/membersCache');
const { pickReactionPriority } = require('../../shared/presenceReactions');

function avatarUrl(userId, avatar, size = 64) {
    return avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=${size}` : null;
}

function summarizeMember(member, extra = {}) {
    return {
        id: member.id,
        username: member.nickname || member.user.username,
        avatar: avatarUrl(member.id, member.user.avatar),
        color: member.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
        ...extra,
    };
}

function registerPresenceStatsRoutes(app, deps) {
    const {
        requireAuth,
        requireFullSiteAccess,
        getBotClient,
        getBotState,
        emitRealtime,
    } = deps;

    app.get('/api/presence', requireAuth, requireFullSiteAccess, async (req, res) => {
        const state = getBotState();
        const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
        if (!guild) return res.json({ error: 'Guild not found' });

        const role = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1);
        if (!role) return res.json({ error: 'Role not found' });

        const collectFromOP = (data, reactionMap) => {
            const result = {
                active: data.active,
                terminated: false,
                present: [],
                late: [],
                absentReact: [],
                absentValid: [],
                noReaction: [],
            };

            if (!data.active || !data.messageId) return result;

            for (const [, member] of role.members) {
                if (member.user.bot) continue;
                if (member.roles.cache.has(state.CONFIG.ROLES.EXCLUDED_ROLE)) continue;

                const name = member.nickname || member.user.username;
                const item = {
                    id: member.id,
                    user_id: member.id,
                    name,
                    username: name,
                    avatar: avatarUrl(member.id, member.user.avatar),
                    avatar_url: avatarUrl(member.id, member.user.avatar),
                    color: member.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
                    role_color: member.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
                };
                const reaction = pickReactionPriority(reactionMap.get(member.id));

                if (state.absenceSalonCache.validAbsences.has(member.id)) result.absentValid.push(item);
                else if (reaction === 'check') result.present.push(item);
                else if (reaction === 'retard') result.late.push(item);
                else if (reaction === 'no') result.absentReact.push(item);
                else result.noReaction.push(item);
            }

            return result;
        };

        const op1 = collectFromOP(state.presenceData, state.reactionsOP1);
        const op2 = collectFromOP(state.presence2Data, state.reactionsOP2);

        const buildDecroches = () => {
            const op1Started = Boolean(state.presenceData.active && state.presenceData.messageId);
            const op2Started = Boolean(state.presence2Data.active && state.presence2Data.messageId);
            const op2HasReaction = Boolean(state.reactionsOP2?.size);
            if (!op1Started) {
                return {
                    count: 0,
                    members: [],
                    message: '1ère présence OP non démarrée',
                    hidden: true,
                };
            }
            if (!op2Started || !op2HasReaction) {
                return {
                    count: null,
                    members: [],
                    message: 'En attente de la 2ème OP',
                };
            }

            const op1PresentMembers = new Map();
            for (const member of op1.present) op1PresentMembers.set(member.id, { member, statut_1ere: 'présent' });
            for (const member of op1.late) op1PresentMembers.set(member.id, { member, statut_1ere: 'retard' });

            const op2Dropped = new Map();
            for (const member of op2.noReaction) op2Dropped.set(member.id, 'pasDeReaction');
            for (const member of op2.absentReact) op2Dropped.set(member.id, 'absentNonJustifie');

            const members = [...op1PresentMembers.entries()]
                .filter(([id]) => op2Dropped.has(id))
                .map(([id, entry]) => ({
                    user_id: id,
                    username: entry.member.username || entry.member.name,
                    avatar_url: entry.member.avatar_url || entry.member.avatar,
                    role_color: entry.member.role_color || entry.member.color,
                    statut_1ere: entry.statut_1ere,
                    statut_2eme: op2Dropped.get(id),
                }))
                .sort((a, b) => a.username.localeCompare(b.username, 'fr', { sensitivity: 'base' }));

            return {
                count: members.length,
                members,
                message: members.length ? null : 'Aucun décrochage',
            };
        };

        res.json({
            op1,
            op2,
            decrochesEntre1ereEt2eme: buildDecroches(),
            absencesSalon: {
                valid: state.absenceSalonCache.validAbsenceNames || [],
                invalid: state.absenceSalonCache.invalidAbsenceNames || [],
            },
        });
    });

    app.get('/api/weekly', requireAuth, requireFullSiteAccess, async (req, res) => {
        const state = getBotState();
        const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
        const membersCache = guild ? await getCachedMembers(guild).catch(() => guild.members.cache) : null;

        const tracking = await Promise.all([...state.absenceTracking.entries()].map(async ([id, data]) => {
            let avatar = null;
            const member = membersCache?.get?.(id);
            if (member) avatar = avatarUrl(id, member.user.avatar);
            return {
                id,
                username: data.username,
                avatar,
                count: data.count,
                details: data.details || [],
                consecutiveDays: state.getConsecutiveDays(data),
            };
        }));

        tracking.sort((a, b) => b.count - a.count);
        res.json({ tracking });
    });

    app.post('/api/tracking/reset', requireAuth, requireFullSiteAccess, (req, res) => {
        const { userId } = req.body;
        const state = getBotState();
        if (state.absenceTracking.has(userId)) {
            state.absenceTracking.delete(userId);
            state.saveAbsenceTracking();
            emitRealtime('absence:posted', { userId, action: 'reset' });
            return res.json({ success: true });
        }
        res.status(404).json({ error: 'User not in tracking' });
    });

    app.get('/api/stats', requireAuth, requireFullSiteAccess, async (req, res) => {
        const state = getBotState();
        const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
        const membersCache = guild ? await getCachedMembers(guild).catch(() => guild.members.cache) : null;

        let totalMembers = 0;
        let totalMembersList = [];
        if (guild) {
            const counted = new Set();
            const role1 = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1);
            const role2 = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_2);
            if (role1) for (const [id, member] of role1.members) if (!member.user.bot) counted.add(id);
            if (role2) for (const [id, member] of role2.members) if (!member.user.bot) counted.add(id);
            totalMembers = counted.size;
            totalMembersList = [...counted]
                .map(id => membersCache?.get?.(id) || guild.members.cache.get(id))
                .filter(Boolean)
                .map(member => summarizeMember(member))
                .sort((a, b) => a.username.localeCompare(b.username, 'fr'));
        }

        const role = guild ? guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1) : null;
        const inscritsOP = role ? role.members.filter(member => !member.user.bot).size : 0;
        const inscritsList = role
            ? [...role.members.values()]
                .filter(member => !member.user.bot)
                .map(member => summarizeMember(member))
                .sort((a, b) => a.username.localeCompare(b.username, 'fr'))
            : [];

        const trackingEntries = [...state.absenceTracking.entries()];
        const tracking = trackingEntries.map(([, item]) => item);
        const totalUnjustified = tracking.reduce((sum, item) => sum + item.count, 0);
        const withConsecutive = tracking.filter(item => state.getConsecutiveDays(item) >= 2).length;
        const absenceMembers = trackingEntries.map(([id, item]) => {
            const member = membersCache?.get?.(id) || guild?.members.cache.get(id);
            return {
                id,
                username: item.username || member?.nickname || member?.user?.username || id,
                avatar: member?.user?.avatar ? avatarUrl(id, member.user.avatar) : null,
                color: member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
                count: item.count || 0,
                consecutiveDays: state.getConsecutiveDays(item),
                dates: item.dates || [],
                details: item.details || [],
            };
        }).sort((a, b) => (b.count - a.count) || a.username.localeCompare(b.username, 'fr'));
        const kpMembers = absenceMembers.filter(member => member.consecutiveDays >= 2);

        res.json({
            totalMembers,
            inscritsOP,
            totalUnjustified,
            membersWithAbsences: tracking.length,
            membersWithConsecutive: withConsecutive,
            totalMembersList,
            inscritsList,
            absenceMembers,
            kpMembers,
            op1Active: state.presenceData.active,
            op2Active: state.presence2Data.active,
        });
    });
}

module.exports = {
    registerPresenceStatsRoutes,
};
