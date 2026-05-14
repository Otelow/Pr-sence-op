// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes présence et statistiques isolées

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
                    name,
                    avatar: avatarUrl(member.id, member.user.avatar),
                };
                const reaction = reactionMap.get(member.id);

                if (reaction === 'check') result.present.push(item);
                else if (reaction === 'retard') result.late.push(item);
                else if (reaction === 'no') result.absentReact.push(item);
                else if (state.absenceSalonCache.validAbsences.has(member.id)) result.absentValid.push(item);
                else result.noReaction.push(item);
            }

            return result;
        };

        res.json({
            op1: collectFromOP(state.presenceData, state.reactionsOP1),
            op2: collectFromOP(state.presence2Data, state.reactionsOP2),
            absencesSalon: {
                valid: state.absenceSalonCache.validAbsenceNames || [],
                invalid: state.absenceSalonCache.invalidAbsenceNames || [],
            },
        });
    });

    app.get('/api/weekly', requireAuth, requireFullSiteAccess, async (req, res) => {
        const state = getBotState();
        const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);

        const tracking = await Promise.all([...state.absenceTracking.entries()].map(async ([id, data]) => {
            let avatar = null;
            if (guild) {
                try {
                    const member = await guild.members.fetch(id).catch(() => null);
                    if (member) avatar = avatarUrl(id, member.user.avatar);
                } catch {}
            }
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

        if (guild) {
            try { await guild.members.fetch(); } catch {}
        }

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
                .map(id => guild.members.cache.get(id))
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
            const member = guild?.members.cache.get(id);
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
