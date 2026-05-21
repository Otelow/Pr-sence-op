// PRÉSENCE RÉSILIENTE + DÉTAILS 20/05/2026
// STATS PRÉSENCE 19/05/2026 — snapshots minuit + dashboard stats
// HISTORIQUE PRÉSENCE 19/05/2026 — persistance + 7 jours
// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
const { createConnection } = require('../../shared/database');
const { pickReactionPriority } = require('../../shared/presenceReactions');
// MODIFIE CHANTIER 6 - 14/05/2026 - persistance presence OP externalisee

function getParisDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

function dateFromKey(dateStr) {
    const [year, month, day] = String(dateStr || '').split('-').map(Number);
    if (!year || !month || !day) return new Date();
    return new Date(year, month - 1, day, 12, 0, 0);
}

function serializeReactionMap(map) {
    const out = {};
    if (!map || typeof map.entries !== 'function') return out;
    for (const [userId, set] of map.entries()) {
        out[userId] = [...set];
    }
    return out;
}

function deserializeReactionMap(obj, targetMap) {
    targetMap.clear();
    if (!obj || typeof obj !== 'object') return;
    for (const [userId, types] of Object.entries(obj)) {
        if (Array.isArray(types)) {
            targetMap.set(userId, new Set(types));
        }
    }
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
        CREATE INDEX IF NOT EXISTS idx_presence_history_date ON presence_history(date DESC);
        CREATE INDEX IF NOT EXISTS idx_presence_history_user ON presence_history(user_id);
    `);
}

function createPresenceStatePersistence(deps) {
    const {
        fs,
        stateFile,
        CONFIG,
        client,
        reactionsOP1,
        reactionsOP2,
        getPresenceData,
        getPresence2Data,
        getAbsentUsersToday,
    } = deps;

    function hasPresenceDataToSnapshot() {
        const presenceData = getPresenceData();
        const presence2Data = getPresence2Data();
        return Boolean(
            presenceData?.messageId ||
            presence2Data?.messageId ||
            reactionsOP1?.size ||
            reactionsOP2?.size
        );
    }

    function collectPresenceHistoryEntries(opData, reactionMap, validAbsences, role) {
        const entries = new Map();
        if (!opData?.messageId && !opData?.active && !opData?.terminated && (!reactionMap || reactionMap.size === 0)) {
            return entries;
        }

        for (const [, member] of role.members) {
            if (member.user.bot) continue;
            if (member.roles.cache.has(CONFIG.ROLES.EXCLUDED_ROLE)) continue;

            let status = 'noReaction';
            if (validAbsences.has(member.id)) {
                status = 'absentValid';
            } else {
                const reaction = pickReactionPriority(reactionMap.get(member.id));
                if (reaction === 'check') status = 'present';
                else if (reaction === 'retard') status = 'late';
                else if (reaction === 'no') status = 'absentReact';
            }

            entries.set(member.id, {
                username: member.nickname || member.user.username,
                status,
            });
        }

        return entries;
    }

    function hasPresenceSnapshot(dateStr, options = {}) {
        if (!dateStr) return false;
        const { only = null } = options;
        const db = createConnection();
        ensurePresenceHistoryTable(db);
        if (only === 'op1') {
            return Boolean(db.prepare('SELECT 1 FROM presence_history WHERE date = ? AND op_number = 1 LIMIT 1').get(dateStr));
        }
        if (only === 'op2') {
            return Boolean(db.prepare('SELECT 1 FROM presence_history WHERE date = ? AND op_number = 2 LIMIT 1').get(dateStr));
        }
        return Boolean(db.prepare('SELECT 1 FROM presence_history WHERE date = ? LIMIT 1').get(dateStr));
    }

    async function snapshotPresenceDay(dateStr, options = {}) {
        if (!dateStr || !hasPresenceDataToSnapshot()) return false;
        const { only = null } = options;

        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const role = guild?.roles.cache.get(CONFIG.ROLES.MEMBRE_1);
        if (!role) return false;

        const absData = await getAbsentUsersToday(dateFromKey(dateStr));
        const validAbsences = absData.validAbsences || new Set();
        const op1Entries = only === 'op2' ? new Map() : collectPresenceHistoryEntries(getPresenceData(), reactionsOP1, validAbsences, role);
        const op2Entries = only === 'op1' ? new Map() : collectPresenceHistoryEntries(getPresence2Data(), reactionsOP2, validAbsences, role);

        const db = createConnection();
        ensurePresenceHistoryTable(db);
        const recordedAt = Math.floor(Date.now() / 1000);
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO presence_history
            (date, op_number, user_id, username, status, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const tx = db.transaction((ops) => {
            for (const op of ops) {
                for (const [userId, entry] of op.entries) {
                    stmt.run(dateStr, op.num, userId, entry.username, entry.status, recordedAt);
                }
            }
        });

        const ops = [];
        if (only !== 'op2') ops.push({ num: 1, entries: op1Entries });
        if (only !== 'op1') ops.push({ num: 2, entries: op2Entries });
        if (ops.length === 0) return false;

        tx(ops);
        log.info(`📸 Snapshot présence ${dateStr} : OP1 ${op1Entries.size} / OP2 ${op2Entries.size}`);
        return true;
    }

    function savePresenceState() {
        try {
            const presenceData = getPresenceData();
            const presence2Data = getPresence2Data();
            const state = {
                op1: {
                    messageId: presenceData.messageId,
                    active: presenceData.active,
                    terminated: Boolean(presenceData.terminated),
                    startedAt: presenceData.startedAt || null,
                    reactions: serializeReactionMap(reactionsOP1),
                },
                op2: {
                    messageId: presence2Data.messageId,
                    active: presence2Data.active,
                    terminated: Boolean(presence2Data.terminated),
                    startedAt: presence2Data.startedAt || null,
                    reactions: serializeReactionMap(reactionsOP2),
                },
                currentDay: getParisDateKey(new Date()),
                savedAt: new Date().toISOString(),
            };
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
        } catch (e) {
            log.error('❌ Erreur sauvegarde état présence:', e.message);
        }
    }

    function loadPresenceState() {
        try {
            if (fs.existsSync(stateFile)) {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                log.info(`📋 État présence chargé (sauvé à ${state.savedAt})`);
                return state;
            }
        } catch (e) {
            log.error('❌ Erreur chargement état présence:', e.message);
        }
        return null;
    }

    function clearPresenceState() {
        try {
            if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
        } catch {}
    }

    return {
        savePresenceState,
        loadPresenceState,
        clearPresenceState,
        getParisDateKey,
        deserializeReactionMap,
        hasPresenceSnapshot,
        snapshotPresenceDay,
    };
}

module.exports = {
    createPresenceStatePersistence,
    serializeReactionMap,
    deserializeReactionMap,
};
