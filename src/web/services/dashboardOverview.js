// CCV5 21/05/2026 — palette stricte + cards cliquables + fix
// COMMAND CENTER v4 20/05/2026 — refonte fidèle mockup
const { pickReactionPriority } = require('../../shared/presenceReactions');
const { createConnection } = require('../../shared/database');

function getParisDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function shiftDateKey(dateKey, days) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function getMondayParis(date = new Date()) {
    const today = getParisDateKey(date);
    const utcDate = new Date(`${today}T00:00:00Z`);
    const day = utcDate.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    utcDate.setUTCDate(utcDate.getUTCDate() - daysSinceMonday);
    return utcDate.toISOString().slice(0, 10);
}

function getMondayBeforeParis(date = new Date()) {
    return shiftDateKey(getMondayParis(date), -7);
}

function ensurePresenceHistoryTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS presence_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            op_number INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT,
            status TEXT NOT NULL,
            recorded_at INTEGER NOT NULL,
            UNIQUE(date, op_number, user_id)
        );
    `);
}

function safeCount(db, sql, params = []) {
    try {
        const row = db.prepare(sql).get(...params);
        return Number(row?.c || 0);
    } catch {
        return 0;
    }
}

function getEligibleRoleMembers(client, state, roleId) {
    const guildId = process.env.GUILD_ID || state?.CONFIG?.GUILD_ID;
    const guild = client?.guilds?.cache?.get(guildId);
    const role = guild?.roles?.cache?.get(roleId);
    if (!role) return [];
    const excludedRole = state?.CONFIG?.ROLES?.EXCLUDED_ROLE;
    return [...role.members.values()]
        .filter(member => !member.user?.bot)
        .filter(member => !excludedRole || !member.roles?.cache?.has(excludedRole));
}

async function getRoleMembersCount(client, state, roleId) {
    return getEligibleRoleMembers(client, state, roleId).length;
}

function getCurrentPresenceLive(client, state) {
    const memberRoleId = process.env.MEMBER_ROLE_ID || state?.CONFIG?.ROLES?.MEMBRE_1;
    const members = getEligibleRoleMembers(client, state, memberRoleId);
    const validAbsences = state?.absenceSalonCache?.validAbsences || new Set();
    const reactionsOP1 = state?.reactionsOP1 || new Map();
    const reactionsOP2 = state?.reactionsOP2 || new Map();

    const live = {
        total: members.length,
        presents: 0,
        retards: 0,
        absentsJustifies: 0,
        decroches: 0,
    };

    const op1PresentIds = new Set();
    for (const member of members) {
        const reaction = pickReactionPriority(reactionsOP1.get(member.id));
        if (validAbsences.has(member.id)) {
            live.absentsJustifies += 1;
        } else if (reaction === 'check') {
            live.presents += 1;
            op1PresentIds.add(member.id);
        } else if (reaction === 'retard') {
            live.retards += 1;
            op1PresentIds.add(member.id);
        }
    }

    const op2Started = Boolean(state?.presence2Data?.active || state?.presence2Data?.terminated || state?.presence2Data?.messageId);
    if (op2Started && reactionsOP2.size > 0) {
        for (const userId of op1PresentIds) {
            const reaction = pickReactionPriority(reactionsOP2.get(userId));
            if (!reaction || reaction === 'no') live.decroches += 1;
        }
    }

    return live;
}

function computeWeekPresenceRate(db, mondayStr) {
    const nextMonday = shiftDateKey(mondayStr, 7);
    const rows = db.prepare(`
        SELECT status, COUNT(*) as c
        FROM presence_history
        WHERE date >= ? AND date < ?
        GROUP BY status
    `).all(mondayStr, nextMonday);
    const total = rows.reduce((sum, row) => sum + Number(row.c || 0), 0);
    const present = rows
        .filter(row => row.status === 'present' || row.status === 'late')
        .reduce((sum, row) => sum + Number(row.c || 0), 0);
    return total > 0 ? Math.round((present / total) * 100) : 0;
}

async function buildDashboardOverview({ client, state, now = new Date() }) {
    const db = createConnection();
    try {
        ensurePresenceHistoryTable(db);
        const memberRoleId = process.env.MEMBER_ROLE_ID || state?.CONFIG?.ROLES?.MEMBRE_1;
        const presenceLive = getCurrentPresenceLive(client, state);
        const membersTotal = await getRoleMembersCount(client, state, memberRoleId);
        const monday = getMondayParis(now);
        const previousMonday = getMondayBeforeParis(now);
        const tauxPresenceWeek = computeWeekPresenceRate(db, monday);
        const tauxPresencePreviousWeek = computeWeekPresenceRate(db, previousMonday);
        const trendPercent = tauxPresencePreviousWeek > 0
            ? Math.round(((tauxPresenceWeek - tauxPresencePreviousWeek) / tauxPresencePreviousWeek) * 100)
            : 0;

        return {
            presence: {
                total: presenceLive.total,
                presents: presenceLive.presents,
                retards: presenceLive.retards,
                absentsJustifies: presenceLive.absentsJustifies,
                decroches: presenceLive.decroches,
                taux: presenceLive.total > 0 ? Math.round((presenceLive.presents / presenceLive.total) * 100) : 0,
                trendPercent,
            },
            membres: { total: membersTotal, role: '21BS' },
            crafts: {
                ouverts: safeCount(db, `
                    SELECT COUNT(*) as c
                    FROM craft_requests
                    WHERE status NOT IN ('completed', 'rejected', 'cancelled', 'sold')
                `),
            },
            weapons: {
                onSale: safeCount(db, 'SELECT COUNT(*) as c FROM my_weapons WHERE COALESCE(is_sold, 0) = 0'),
                inProgress: safeCount(db, 'SELECT COUNT(*) as c FROM my_weapons WHERE COALESCE(is_sold, 0) = 0 AND COALESCE(is_in_progress, 0) = 1'),
            },
            absences: {
                week: safeCount(db, `
                    SELECT COUNT(DISTINCT user_id) as c
                    FROM presence_history
                    WHERE date >= ? AND status IN ('absentValid', 'absentReact', 'noReaction')
                `, [monday]),
                conformes: safeCount(db, `
                    SELECT COUNT(DISTINCT user_id) as c
                    FROM presence_history
                    WHERE date >= ? AND status = 'absentValid'
                `, [monday]),
                kp: 0,
            },
        };
    } finally {
        db.close?.();
    }
}

module.exports = {
    buildDashboardOverview,
    computeWeekPresenceRate,
    getEligibleRoleMembers,
    getCurrentPresenceLive,
    getMondayBeforeParis,
    getMondayParis,
    getRoleMembersCount,
};
