// FIX DÉCROCHÉS + CARDS 22/05/2026
// PRÉSENCE RÉSILIENTE + DÉTAILS 20/05/2026
// STATS PRÉSENCE 19/05/2026 — snapshots minuit + dashboard stats
// HISTORIQUE PRÉSENCE 19/05/2026 — persistance + 7 jours
// FIX PRÉSENCE 18/05/2026 — 3 bugs classification corrigés
// DÉCROCHÉS OP 18/05/2026 — section décrochage entre 1ère et 2ème
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes présence et statistiques isolées

// FINAL POST-STAB F 17/05/2026 — cache membres Discord côté serveur
const { getCachedMembers } = require('../services/membersCache');
const { pickReactionPriority } = require('../../shared/presenceReactions');
const { createConnection } = require('../../shared/database');
const { computeDecroches, isLikelyCopiedOpRows, wasOpLaunched } = require('../services/presenceHelpers');

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

function aggregateByStatus(rows) {
    const counts = { present: 0, late: 0, absentReact: 0, absentValid: 0, noReaction: 0 };
    for (const row of rows) {
        if (row.status in counts) counts[row.status] += 1;
    }
    return { total: rows.length, counts, members: rows };
}

function aggregateCounts(statuses) {
    const counts = { present: 0, late: 0, absentReact: 0, absentValid: 0, noReaction: 0 };
    for (const status of statuses) {
        if (status in counts) counts[status] += 1;
    }
    return counts;
}

function groupRowsByStatus(rows) {
    const groups = { present: [], late: [], absentReact: [], absentValid: [], noReaction: [] };
    for (const row of rows || []) {
        if (row.status in groups) groups[row.status].push(row);
    }
    return groups;
}

function previousDateKey(dateStr) {
    const [year, month, day] = String(dateStr || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function getParisDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function reactionToPresenceStatus(reaction) {
    if (reaction === 'check') return 'present';
    if (reaction === 'retard') return 'late';
    if (reaction === 'no') return 'absentReact';
    if (reaction === 'absenceValid') return 'absentValid';
    return 'noReaction';
}

function buildPresenceRowsByDate(rows) {
    const byDate = {};
    for (const row of rows) {
        if (!byDate[row.date]) byDate[row.date] = { op1: [], op2: [] };
        const key = `op${row.op_number}`;
        if (!byDate[row.date][key]) byDate[row.date][key] = [];
        byDate[row.date][key].push(row);
    }
    return byDate;
}

function repairCopiedOp2Rows(db, byDate, dates) {
    const repaired = [];
    const deleteOp2 = db.prepare('DELETE FROM presence_history WHERE date = ? AND op_number = 2');

    for (const date of dates) {
        const previousDate = previousDateKey(date);
        if (!previousDate || !byDate[date] || !byDate[previousDate]) continue;
        const currentOp2 = byDate[date].op2 || [];
        const previousOp2 = byDate[previousDate].op2 || [];
        if (!isLikelyCopiedOpRows(currentOp2, previousOp2)) continue;

        deleteOp2.run(date);
        byDate[date].op2 = [];
        repaired.push(date);
    }

    return repaired;
}

function flattenPresenceRows(byDate, sinceStr = null) {
    return Object.entries(byDate)
        .filter(([date]) => !sinceStr || date >= sinceStr)
        .flatMap(([, data]) => [...(data.op1 || []), ...(data.op2 || [])]);
}

function registerPresenceStatsRoutes(app, deps) {
    const {
        requireAuth,
        requireFullSiteAccess,
        getBotClient,
        getBotState,
        emitRealtime,
    } = deps;

    app.get('/api/presence', requireAuth, async (req, res) => {
        const state = getBotState();
        if (req.query.sync === '1' || req.query.sync === 'true') {
            await Promise.allSettled([
                state.syncPresenceReactions?.(),
                state.updateAbsenceSalonCache?.({ force: true }),
            ]);
        }

        const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
        if (!guild) return res.json({ error: 'Guild not found' });

        const role = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1);
        if (!role) return res.json({ error: 'Role not found' });

        const collectFromOP = (data, reactionMap, manualOverrideMap = new Map()) => {
            const result = {
                active: data.active,
                terminated: Boolean(data.terminated),
                editable: Boolean(data.active || data.terminated || data.messageId || reactionMap.size || manualOverrideMap.size),
                present: [],
                late: [],
                absentReact: [],
                absentValid: [],
                noReaction: [],
            };

            if (!result.editable) return result;

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
                const hasManualOverride = manualOverrideMap.has(member.id);
                const reaction = pickReactionPriority(hasManualOverride ? manualOverrideMap.get(member.id) : reactionMap.get(member.id));
                const hasValidAbsence = state.absenceSalonCache.validAbsences.has(member.id);
                item.hasValidAbsence = hasValidAbsence;
                item.reaction = hasManualOverride ? (reaction || 'none') : (hasValidAbsence ? 'absenceValid' : (reaction || 'none'));
                item.manualOverride = hasManualOverride;

                if (hasManualOverride && reaction === 'absenceValid') result.absentValid.push(item);
                else if (!hasManualOverride && hasValidAbsence) result.absentValid.push(item);
                else if (reaction === 'check') result.present.push(item);
                else if (reaction === 'retard') result.late.push(item);
                else if (reaction === 'no') result.absentReact.push(item);
                else result.noReaction.push(item);
            }

            return result;
        };

        const op1 = collectFromOP(state.presenceData, state.reactionsOP1, state.manualPresenceOverridesOP1);
        const op2 = collectFromOP(state.presence2Data, state.reactionsOP2, state.manualPresenceOverridesOP2);

        const buildDecroches = () => {
            const op1Started = Boolean(state.presenceData.active && state.presenceData.messageId);
            if (!op1Started) {
                return {
                    count: 0,
                    members: [],
                    message: '1ère présence OP non démarrée',
                    hidden: true,
                };
            }
            if (!wasOpLaunched(op2)) {
                return {
                    count: null,
                    members: [],
                    op2Launched: false,
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
                op2Launched: true,
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

    app.patch('/api/presence/reaction', requireAuth, requireFullSiteAccess, async (req, res) => {
        const { op, userId, reaction } = req.body || {};
        const normalizedOp = op === 'op2' ? 'op2' : op === 'op1' ? 'op1' : null;
        const normalizedReaction = reaction || 'none';
        const allowedReactions = new Set(['absenceValid', 'none', 'check', 'retard', 'no']);

        if (!normalizedOp) return res.status(400).json({ error: 'OP invalide' });
        if (!/^\d{15,25}$/.test(String(userId || ''))) return res.status(400).json({ error: 'Utilisateur invalide' });
        if (!allowedReactions.has(normalizedReaction)) return res.status(400).json({ error: 'Réaction invalide' });

        const state = getBotState();
        const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
        const member = await guild?.members.fetch(String(userId)).catch(() => null);
        if (!member) return res.status(404).json({ error: 'Membre introuvable' });

        const data = normalizedOp === 'op2' ? state.presence2Data : state.presenceData;
        const reactionMap = normalizedOp === 'op2' ? state.reactionsOP2 : state.reactionsOP1;
        const manualOverrideMap = normalizedOp === 'op2' ? state.manualPresenceOverridesOP2 : state.manualPresenceOverridesOP1;
        if (!data?.messageId && !data?.active && !data?.terminated && !reactionMap?.size && !manualOverrideMap?.size) {
            return res.status(400).json({ error: 'Présence OP inactive' });
        }

        const previousReaction = pickReactionPriority(manualOverrideMap?.get(String(userId)) || reactionMap.get(String(userId))) || 'none';
        if (normalizedReaction === 'absenceValid' && state.absenceSalonCache?.validAbsences?.has(String(userId))) {
            state.clearManualPresenceReaction?.(normalizedOp, String(userId));
        }
        else if (normalizedReaction === 'absenceValid') state.setManualPresenceReaction?.(normalizedOp, String(userId), 'absenceValid');
        else state.setManualPresenceReaction?.(normalizedOp, String(userId), normalizedReaction);
        state.savePresenceState?.();
        await state.refreshAbsencePanel?.();

        const presenceChannel = getBotClient().channels.cache.get(state.CONFIG.CHANNELS.PRESENCE);
        if (previousReaction === 'check' && (normalizedReaction === 'retard' || normalizedReaction === 'no') && presenceChannel) {
            const message = normalizedReaction === 'retard'
                ? `${member} Tu n'es pas présent alors que tu as signalé ta présence. Merci de mettre une absence dans <#${state.CONFIG.CHANNELS.ABSENCE}> ou de signaler ton retard.`
                : `${member} Tu as signalé que tu étais présent mais tu ne l'es pas. Merci de mettre une absence dans <#${state.CONFIG.CHANNELS.ABSENCE}> pour que ce soit pris en compte.`;
            await presenceChannel.send({
                content: message,
                allowedMentions: { users: [String(userId)] },
            }).catch(() => {});
        }

        emitRealtime('presence:reaction', {
            op: normalizedOp,
            userId: String(userId),
            type: normalizedReaction === 'none' ? null : normalizedReaction,
            manual: true,
        });
        emitRealtime('presence:update', { manual: true, op: normalizedOp });

        res.json({
            success: true,
            op: normalizedOp,
            userId: String(userId),
            previousReaction,
            reaction: normalizedReaction,
        });
    });

    app.patch('/api/presence/history/:date/reaction', requireAuth, requireFullSiteAccess, async (req, res) => {
        const date = req.params.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Format date invalide (YYYY-MM-DD)' });
        }
        if (date !== getParisDateKey()) {
            return res.status(403).json({ error: 'Modification autorisée uniquement pour le jour J' });
        }

        const { op, userId, reaction } = req.body || {};
        const normalizedOp = op === 'op2' ? 'op2' : op === 'op1' ? 'op1' : null;
        const normalizedReaction = reaction || 'none';
        const allowedReactions = new Set(['absenceValid', 'none', 'check', 'retard', 'no']);
        if (!normalizedOp) return res.status(400).json({ error: 'OP invalide' });
        if (!/^\d{15,25}$/.test(String(userId || ''))) return res.status(400).json({ error: 'Utilisateur invalide' });
        if (!allowedReactions.has(normalizedReaction)) return res.status(400).json({ error: 'Réaction invalide' });

        const state = getBotState();
        const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
        const member = await guild?.members.fetch(String(userId)).catch(() => null);
        if (!member || member.user?.bot) return res.status(404).json({ error: 'Membre introuvable' });
        if (member.roles?.cache?.has(state.CONFIG.ROLES.EXCLUDED_ROLE)) {
            return res.status(400).json({ error: 'Membre exclu de la présence OP' });
        }

        const opNumber = normalizedOp === 'op2' ? 2 : 1;
        const status = reactionToPresenceStatus(normalizedReaction);
        const username = member.nickname || member.user.username;
        const db = createConnection();
        ensurePresenceHistoryTable(db);
        db.prepare(`
            INSERT OR REPLACE INTO presence_history
            (date, op_number, user_id, username, status, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(date, opNumber, String(userId), username, status, Math.floor(Date.now() / 1000));

        state.setManualPresenceReaction?.(normalizedOp, String(userId), normalizedReaction);
        state.savePresenceState?.();
        await state.refreshAbsencePanel?.();
        emitRealtime('presence:reaction', {
            op: normalizedOp,
            userId: String(userId),
            type: normalizedReaction === 'none' ? null : normalizedReaction,
            manual: true,
            history: true,
        });
        emitRealtime('presence:update', { manual: true, history: true, op: normalizedOp });

        return res.json({
            success: true,
            date,
            op: normalizedOp,
            userId: String(userId),
            reaction: normalizedReaction,
            status,
        });
    });

    app.get('/api/presence/history', requireAuth, (req, res) => {
        const rawDays = parseInt(req.query.days || '7', 10);
        const days = Math.min(Math.max(Number.isFinite(rawDays) ? rawDays : 7, 1), 30);
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
        const sinceStr = sinceDate.toISOString().slice(0, 10);
        const repairSinceDate = new Date(sinceDate);
        repairSinceDate.setDate(repairSinceDate.getDate() - 1);
        const repairSinceStr = repairSinceDate.toISOString().slice(0, 10);

        const db = createConnection();
        ensurePresenceHistoryTable(db);
        const rows = db.prepare(`
            SELECT date, op_number, user_id, username, status, recorded_at
            FROM presence_history
            WHERE date >= ?
            ORDER BY date DESC, op_number ASC, username COLLATE NOCASE ASC
        `).all(repairSinceStr);

        const byDate = buildPresenceRowsByDate(rows);
        repairCopiedOp2Rows(db, byDate, Object.keys(byDate).filter(date => date >= sinceStr));

        const history = Object.entries(byDate).filter(([date]) => date >= sinceStr).map(([date, data]) => {
            const op1Groups = groupRowsByStatus(data.op1);
            const op2Groups = groupRowsByStatus(data.op2);
            const op2Launched = wasOpLaunched(op2Groups);
            const decrocheurs = computeDecroches(op1Groups, op2Groups);

            return {
                date,
                op1: aggregateByStatus(data.op1),
                op2: aggregateByStatus(data.op2),
                op2Launched,
                decroches: decrocheurs.map(row => ({
                    user_id: row.user_id,
                    username: row.username,
                    statut_op1: data.op1.find(item => item.user_id === row.user_id)?.status,
                    statut_op2: row.status,
                })),
            };
        });

        res.json({ days, history });
    });

    app.get('/api/presence/history/:date', requireAuth, (req, res) => {
        const date = req.params.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Format date invalide (YYYY-MM-DD)' });
        }

        const db = createConnection();
        ensurePresenceHistoryTable(db);
        const previousDate = previousDateKey(date);
        const rows = db.prepare(`
            SELECT date, op_number, user_id, username, status, recorded_at
            FROM presence_history
            WHERE date IN (?, ?)
            ORDER BY date ASC, op_number ASC, status ASC, username COLLATE NOCASE ASC
        `).all(previousDate || date, date);
        const byDate = buildPresenceRowsByDate(rows);
        repairCopiedOp2Rows(db, byDate, [date]);
        const dayRows = flattenPresenceRows(byDate, date).filter(row => row.date === date);

        const makeOp = () => ({ present: [], late: [], absentReact: [], absentValid: [], noReaction: [] });
        const op1 = makeOp();
        const op2 = makeOp();
        for (const row of dayRows) {
            const target = Number(row.op_number) === 1 ? op1 : op2;
            if (row.status in target) {
                target[row.status].push({
                    user_id: row.user_id,
                    username: row.username || row.user_id,
                });
            }
        }

        const op2Launched = wasOpLaunched(op2);
        const decroches = computeDecroches(op1, op2);

        return res.json({ date, editable: date === getParisDateKey(), op1, op2, op2Launched, decroches });
    });

    app.get('/api/presence/stats', requireAuth, (req, res) => {
        const rawDays = parseInt(req.query.days || '30', 10);
        const days = Math.min(Math.max(Number.isFinite(rawDays) ? rawDays : 30, 1), 90);
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
        const sinceStr = sinceDate.toISOString().slice(0, 10);
        const repairSinceDate = new Date(sinceDate);
        repairSinceDate.setDate(repairSinceDate.getDate() - 1);
        const repairSinceStr = repairSinceDate.toISOString().slice(0, 10);

        const db = createConnection();
        ensurePresenceHistoryTable(db);
        const rawRows = db.prepare(`
            SELECT date, op_number, user_id, username, status, recorded_at
            FROM presence_history
            WHERE date >= ?
            ORDER BY date ASC, op_number ASC, username COLLATE NOCASE ASC
        `).all(repairSinceStr);
        const byDate = buildPresenceRowsByDate(rawRows);
        repairCopiedOp2Rows(db, byDate, Object.keys(byDate).filter(date => date >= sinceStr));
        const rows = flattenPresenceRows(byDate, sinceStr);

        const byUser = new Map();
        for (const row of rows) {
            if (!byUser.has(row.user_id)) {
                byUser.set(row.user_id, {
                    user_id: row.user_id,
                    username: row.username,
                    present: 0,
                    late: 0,
                    absentReact: 0,
                    absentValid: 0,
                    noReaction: 0,
                    decroches: 0,
                    totalOps: 0,
                });
            }
            const user = byUser.get(row.user_id);
            if (row.status in user) user[row.status] += 1;
            user.totalOps += 1;
            if (row.username && !user.username) user.username = row.username;
        }

        const byDateStatus = {};
        for (const row of rows) {
            if (!byDateStatus[row.date]) byDateStatus[row.date] = { op1: new Map(), op2: new Map() };
            byDateStatus[row.date][`op${row.op_number}`].set(row.user_id, row.status);
        }

        for (const day of Object.values(byDateStatus)) {
            const op2 = aggregateCounts([...day.op2.values()]);
            if (!wasOpLaunched(op2)) continue;
            for (const [userId, op1Status] of day.op1) {
                if (op1Status === 'present' || op1Status === 'late') {
                    const op2Status = day.op2.get(userId);
                    if (op2Status === 'noReaction' || op2Status === 'absentReact') {
                        const user = byUser.get(userId);
                        if (user) user.decroches += 1;
                    }
                }
            }
        }

        const daily = Object.entries(byDateStatus).map(([date, day]) => {
            const op1 = aggregateCounts([...day.op1.values()]);
            const op2 = aggregateCounts([...day.op2.values()]);
            const op2Launched = wasOpLaunched(op2);
            let decroches = 0;
            if (op2Launched) {
                for (const [userId, op1Status] of day.op1) {
                    if (op1Status === 'present' || op1Status === 'late') {
                        const op2Status = day.op2.get(userId);
                        if (op2Status === 'noReaction' || op2Status === 'absentReact') decroches += 1;
                    }
                }
            }
            return { date, op1, op2, op2Launched, decroches };
        });

        const usersArr = [...byUser.values()].map(user => ({
            ...user,
            username: user.username || user.user_id,
        }));
        const topRegulier = usersArr.slice()
            .sort((a, b) => (b.present - a.present) || (b.late - a.late) || a.username.localeCompare(b.username, 'fr'))
            .slice(0, 5);
        const topDecroche = usersArr.slice()
            .sort((a, b) => (b.decroches - a.decroches) || a.username.localeCompare(b.username, 'fr'))
            .filter(user => user.decroches > 0)
            .slice(0, 5);
        const topAbsent = usersArr.slice()
            .sort((a, b) => ((b.absentReact + b.noReaction) - (a.absentReact + a.noReaction)) || a.username.localeCompare(b.username, 'fr'))
            .filter(user => (user.absentReact + user.noReaction) > 0)
            .slice(0, 5);

        const totalRows = rows.length;
        const totalPresent = usersArr.reduce((sum, user) => sum + user.present, 0);
        const tauxPresence = totalRows > 0 ? Number(((totalPresent / totalRows) * 100).toFixed(1)) : 0;

        res.json({
            period_days: days,
            total_users: byUser.size,
            total_ops: daily.length * 2,
            taux_presence_global: tauxPresence,
            top_regulier: topRegulier,
            top_decroche: topDecroche,
            top_absent: topAbsent,
            daily,
            by_user: usersArr,
        });
    });

    app.get('/api/weekly', requireAuth, async (req, res) => {
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

    app.get('/api/stats', requireAuth, async (req, res) => {
        const state = getBotState();
        const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
        const membersCache = guild ? await getCachedMembers(guild).catch(() => guild.members.cache) : null;

        let totalMembers = 0;
        let totalMembersList = [];
        if (guild) {
            const counted = new Set();
            const role1 = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1);
            if (role1) for (const [id, member] of role1.members) if (!member.user.bot) counted.add(id);
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
