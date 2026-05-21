// CCV5 21/05/2026 — palette stricte + cards cliquables + fix
const { pickReactionPriority } = require('../../shared/presenceReactions');
const { getEligibleRoleMembers, getMondayParis } = require('./dashboardOverview');

function avatarUrl(userId, avatar, size = 64) {
    return avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=${size}` : null;
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

function summarizeMember(member) {
    return {
        id: member.id,
        username: member.nickname || member.user?.username || member.id,
        avatar_url: avatarUrl(member.id, member.user?.avatar),
        roles: [...(member.roles?.cache?.values?.() || [])]
            .filter(role => role?.name && role.name !== '@everyone')
            .map(role => role.name),
        joined_at: member.joinedTimestamp || null,
    };
}

function getMembersList(client, state) {
    const roleId = process.env.MEMBER_ROLE_ID || state?.CONFIG?.ROLES?.MEMBRE_1;
    return getEligibleRoleMembers(client, state, roleId)
        .map(summarizeMember)
        .sort((a, b) => a.username.localeCompare(b.username, 'fr', { sensitivity: 'base' }));
}

function getWeaponsOnSale(db) {
    try {
        return db.prepare(`
            SELECT
                id,
                weapon_name AS name,
                user_name AS owner_name,
                asking_price AS sale_price,
                min_price AS min_sale_price,
                is_in_progress,
                serial_number,
                created_at
            FROM my_weapons
            WHERE COALESCE(is_sold, 0) = 0
            ORDER BY COALESCE(asking_price, 0) DESC, weapon_name COLLATE NOCASE ASC
        `).all();
    } catch {
        return [];
    }
}

function getAbsencesWeek(db, now = new Date()) {
    try {
        ensurePresenceHistoryTable(db);
        const monday = getMondayParis(now);
        return db.prepare(`
            SELECT date, user_id, username, status
            FROM presence_history
            WHERE date >= ? AND status IN ('absentValid', 'absentReact', 'noReaction')
            ORDER BY date DESC, status ASC, username COLLATE NOCASE ASC
        `).all(monday);
    } catch {
        return [];
    }
}

function getCraftsOpen(db) {
    try {
        return db.prepare(`
            SELECT
                r.id,
                COALESCE(w.name, 'Arme') AS weapon_name,
                r.user_name AS requester_name,
                r.status,
                r.created_at
            FROM craft_requests r
            LEFT JOIN weapons w ON w.id = r.weapon_id
            WHERE r.status NOT IN ('completed', 'rejected', 'cancelled', 'sold')
            ORDER BY r.created_at DESC
        `).all();
    } catch {
        return [];
    }
}

function buildPresenceDetail(client, state) {
    const roleId = process.env.MEMBER_ROLE_ID || state?.CONFIG?.ROLES?.MEMBRE_1;
    const members = getEligibleRoleMembers(client, state, roleId);
    const validAbsences = state?.absenceSalonCache?.validAbsences || new Set();
    const reactionsOP1 = state?.reactionsOP1 || new Map();
    const detail = {
        present: [],
        late: [],
        absentValid: [],
        absentReact: [],
        noReaction: [],
    };

    for (const member of members) {
        const item = summarizeMember(member);
        const reaction = pickReactionPriority(reactionsOP1.get(member.id));
        if (validAbsences.has(member.id)) detail.absentValid.push(item);
        else if (reaction === 'check') detail.present.push(item);
        else if (reaction === 'retard') detail.late.push(item);
        else if (reaction === 'no') detail.absentReact.push(item);
        else detail.noReaction.push(item);
    }

    return detail;
}

function getDecrochesToday(client, state) {
    const roleId = process.env.MEMBER_ROLE_ID || state?.CONFIG?.ROLES?.MEMBRE_1;
    const members = getEligibleRoleMembers(client, state, roleId);
    const byId = new Map(members.map(member => [member.id, member]));
    const validAbsences = state?.absenceSalonCache?.validAbsences || new Set();
    const reactionsOP1 = state?.reactionsOP1 || new Map();
    const reactionsOP2 = state?.reactionsOP2 || new Map();
    const op2Started = Boolean(state?.presence2Data?.active || state?.presence2Data?.terminated || state?.presence2Data?.messageId);
    if (!op2Started) return [];

    const op1PresentIds = [];
    for (const member of members) {
        if (validAbsences.has(member.id)) continue;
        const reaction = pickReactionPriority(reactionsOP1.get(member.id));
        if (reaction === 'check' || reaction === 'retard') op1PresentIds.push(member.id);
    }

    return op1PresentIds
        .filter(userId => {
            const reaction = pickReactionPriority(reactionsOP2.get(userId));
            return !reaction || reaction === 'no';
        })
        .map(userId => summarizeMember(byId.get(userId)))
        .sort((a, b) => a.username.localeCompare(b.username, 'fr', { sensitivity: 'base' }));
}

module.exports = {
    buildPresenceDetail,
    getAbsencesWeek,
    getCraftsOpen,
    getDecrochesToday,
    getMembersList,
    getWeaponsOnSale,
};
