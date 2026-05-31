// KICK PROGRAMME 31/05/2026 - exclusion role 17h15 Paris
const fs = require('fs');
const path = require('path');
const log = require('../../shared/logger');
const config = require('../../shared/config');
const { GUILD_ID } = require('../../shared/channels');

const JOB_ID = 'role-kick-20260531-1715';
const TARGET_ROLE_ID = '1485270431291277383';
const EXEMPT_USER_IDS = ['769670622380294265', '952986899667103804'];
const SCHEDULED_AT_MS = Date.UTC(2026, 4, 31, 15, 15, 0);
const EXPIRES_AT_MS = Date.UTC(2026, 4, 31, 21, 59, 59);
const DEFAULT_STATE_FILE = path.join(config.paths.data, 'scheduled_role_kick_20260531_1715.json');
const KICK_REASON = 'Exclusion programmee 31/05/2026 17h15 - role 1485270431291277383';

function toId(value) {
    return String(value || '').trim();
}

function getCollectionValues(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (collection instanceof Map) return [...collection.values()];
    if (typeof collection.values === 'function') return [...collection.values()];
    if (typeof collection.array === 'function') return collection.array();
    return [];
}

function memberHasRole(member, roleId) {
    const wanted = toId(roleId);
    if (!member || !wanted) return false;

    if (typeof member.roles?.cache?.has === 'function') {
        return member.roles.cache.has(wanted);
    }

    if (Array.isArray(member.roles)) {
        return member.roles.map(toId).includes(wanted);
    }

    if (member.roles instanceof Set) {
        return member.roles.has(wanted);
    }

    return false;
}

function getMemberId(member) {
    return toId(member?.id || member?.user?.id);
}

function selectRoleKickTargets(members, options = {}) {
    const targetRoleId = toId(options.targetRoleId || TARGET_ROLE_ID);
    const exemptUserIds = new Set((options.exemptUserIds || EXEMPT_USER_IDS).map(toId));

    return getCollectionValues(members).filter(member => {
        const memberId = getMemberId(member);
        if (!memberId || exemptUserIds.has(memberId)) return false;
        return memberHasRole(member, targetRoleId);
    });
}

function getKickScheduleStatus(nowMs = Date.now(), options = {}) {
    const scheduledAtMs = Number.isFinite(options.scheduledAtMs) ? options.scheduledAtMs : SCHEDULED_AT_MS;
    const expiresAtMs = Number.isFinite(options.expiresAtMs) ? options.expiresAtMs : EXPIRES_AT_MS;

    if (nowMs < scheduledAtMs) {
        return { status: 'pending', delayMs: scheduledAtMs - nowMs };
    }

    if (nowMs > expiresAtMs) {
        return { status: 'expired', delayMs: 0 };
    }

    return { status: 'due', delayMs: 0 };
}

function loadKickState(stateFile = DEFAULT_STATE_FILE, logger = log) {
    try {
        if (!fs.existsSync(stateFile)) return { jobId: JOB_ID };
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : { jobId: JOB_ID };
    } catch (e) {
        logger.warn?.(`[scheduled-role-kick] lecture etat impossible: ${e.message}`);
        return { jobId: JOB_ID };
    }
}

function saveKickState(state, stateFile = DEFAULT_STATE_FILE, logger = log) {
    try {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({
            ...state,
            jobId: JOB_ID,
            savedAt: new Date().toISOString(),
        }, null, 2));
    } catch (e) {
        logger.warn?.(`[scheduled-role-kick] sauvegarde etat impossible: ${e.message}`);
    }
}

function isFinalState(state) {
    return Boolean(state?.executedAt || state?.skippedAt);
}

async function getGuild(client, guildId) {
    const cached = client.guilds?.cache?.get?.(guildId);
    if (cached) return cached;
    if (typeof client.guilds?.fetch === 'function') {
        return await client.guilds.fetch(guildId).catch(() => null);
    }
    return null;
}

async function executeScheduledRoleKick(client, context = {}) {
    const logger = context.logger || log;
    const stateFile = context.stateFile || DEFAULT_STATE_FILE;
    const nowMs = Number.isFinite(context.nowMs) ? context.nowMs : Date.now();
    const state = loadKickState(stateFile, logger);

    if (isFinalState(state)) {
        logger.info?.('[scheduled-role-kick] job deja finalise, aucune action');
        return { status: 'already_finalized', state };
    }

    const scheduleStatus = getKickScheduleStatus(nowMs, context);

    if (scheduleStatus.status === 'pending') {
        return { status: 'pending', delayMs: scheduleStatus.delayMs, state };
    }

    if (scheduleStatus.status === 'expired') {
        const skippedState = {
            ...state,
            skippedAt: new Date(nowMs).toISOString(),
            reason: 'expired',
        };
        saveKickState(skippedState, stateFile, logger);
        logger.warn?.('[scheduled-role-kick] fenetre expiree, kick non execute');
        return { status: 'expired', state: skippedState };
    }

    const guild = await getGuild(client, context.guildId || GUILD_ID);

    if (!guild?.members) {
        throw new Error('Guild introuvable ou membres indisponibles');
    }

    if (typeof guild.members.fetch === 'function') {
        await guild.members.fetch();
    }

    const targets = selectRoleKickTargets(guild.members.cache || guild.members, context);
    const kicked = [];
    const failed = [];

    const startedState = {
        ...state,
        startedAt: new Date(nowMs).toISOString(),
        totalTargets: targets.length,
    };
    saveKickState(startedState, stateFile, logger);

    for (const member of targets) {
        const memberId = getMemberId(member);

        try {
            await member.kick(context.reason || KICK_REASON);
            kicked.push(memberId);
            logger.info?.(`[scheduled-role-kick] membre exclu: ${memberId}`);
        } catch (e) {
            failed.push({ userId: memberId, error: e.message });
            logger.error?.(`[scheduled-role-kick] exclusion impossible ${memberId}: ${e.message}`);
        }
    }

    const executedState = {
        ...startedState,
        executedAt: new Date().toISOString(),
        kicked,
        failed,
    };
    saveKickState(executedState, stateFile, logger);

    logger.warn?.(`[scheduled-role-kick] termine: ${kicked.length} exclu(s), ${failed.length} echec(s)`);
    return { status: 'executed', state: executedState };
}

function registerScheduledRoleKick(client, context = {}) {
    const logger = context.logger || log;
    const stateFile = context.stateFile || DEFAULT_STATE_FILE;
    let timer = null;

    async function scheduleOrRun() {
        const state = loadKickState(stateFile, logger);
        if (isFinalState(state)) {
            logger.info?.('[scheduled-role-kick] job deja finalise au boot');
            return { status: 'already_finalized', state };
        }

        const nowMs = Number.isFinite(context.nowMs) ? context.nowMs : Date.now();
        const scheduleStatus = getKickScheduleStatus(nowMs, context);

        if (scheduleStatus.status === 'expired') {
            return executeScheduledRoleKick(client, { ...context, stateFile, logger, nowMs });
        }

        if (scheduleStatus.status === 'due') {
            return executeScheduledRoleKick(client, { ...context, stateFile, logger, nowMs });
        }

        timer = setTimeout(() => {
            void executeScheduledRoleKick(client, { ...context, stateFile, logger });
        }, scheduleStatus.delayMs);
        if (typeof timer.unref === 'function') timer.unref();
        logger.warn?.(`[scheduled-role-kick] job programme dans ${Math.round(scheduleStatus.delayMs / 1000)}s`);
        return { status: 'scheduled', delayMs: scheduleStatus.delayMs };
    }

    if (typeof client.isReady === 'function' && client.isReady()) {
        void scheduleOrRun();
    } else if (typeof client.once === 'function') {
        client.once('ready', () => {
            void scheduleOrRun();
        });
    }

    return {
        execute: () => executeScheduledRoleKick(client, { ...context, stateFile, logger }),
        scheduleOrRun,
        clearTimer: () => {
            if (timer) clearTimeout(timer);
            timer = null;
        },
    };
}

module.exports = {
    EXEMPT_USER_IDS,
    EXPIRES_AT_MS,
    JOB_ID,
    KICK_REASON,
    SCHEDULED_AT_MS,
    TARGET_ROLE_ID,
    executeScheduledRoleKick,
    getKickScheduleStatus,
    loadKickState,
    memberHasRole,
    registerScheduledRoleKick,
    saveKickState,
    selectRoleKickTargets,
};
