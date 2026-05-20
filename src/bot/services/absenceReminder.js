// RELANCE ABSENCE + CONTRASTE 19/05/2026
const { audit } = require('../../shared/auditLog');

const FIRST_CHECK_DELAY_MS = 3_000;
const DELETE_REMINDER_DELAY_MS = 5 * 60 * 1000;
const NEXT_REMINDER_DELAY_MS = 30 * 60 * 1000;
const ABSENCE_CHANNEL_ID = '1485623724622217316';

const reminders = new Map();

let clientRef = null;
let contextRef = {
    absenceSalonCache: null,
    updateAbsenceSalonCache: null,
    scheduleAbsenceSalonCacheUpdate: null,
    channels: {},
    guildId: null,
    logger: console,
};

function log() {
    return contextRef.logger || console;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isPast21hParis(date = new Date()) {
    const parts = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const hour = Number(values.hour || 0);
    return hour >= 21;
}

function getPresenceChannelId() {
    return contextRef.channels?.PRESENCE || '1485270858980135004';
}

function getAbsenceChannelId() {
    return contextRef.channels?.ABSENCE || ABSENCE_CHANNEL_ID;
}

function getAbsenceCache() {
    const source = contextRef.absenceSalonCache;
    return typeof source === 'function' ? source() : source;
}

async function refreshAbsenceCache() {
    if (typeof contextRef.updateAbsenceSalonCache === 'function') {
        return contextRef.updateAbsenceSalonCache({ force: true });
    }

    if (typeof contextRef.scheduleAbsenceSalonCacheUpdate === 'function') {
        contextRef.scheduleAbsenceSalonCacheUpdate('presence-reminder-check');
        await wait(900);
    }

    return getAbsenceCache();
}

async function fetchChannel(channelId) {
    return clientRef?.channels.cache.get(channelId)
        || await clientRef?.channels.fetch(channelId).catch(() => null);
}

async function fetchMember(userId) {
    const guild = contextRef.guildId
        ? clientRef?.guilds.cache.get(contextRef.guildId)
        : clientRef?.guilds.cache.first?.();
    if (!guild) return null;
    return guild.members.cache.get(userId)
        || await guild.members.fetch(userId).catch(() => null);
}

async function deleteLastReminder(entry) {
    if (!entry?.lastMessageId || !entry.lastChannelId) return;
    const channel = await fetchChannel(entry.lastChannelId);
    const message = await channel?.messages.fetch(entry.lastMessageId).catch(() => null);
    await message?.delete().catch(() => {});
}

function auditReminder(action, userId, details = {}) {
    audit(
        { id: clientRef?.user?.id || 'bot', username: clientRef?.user?.username || 'Bot' },
        action,
        {
            target_type: 'user',
            target_id: userId,
            details: { user_id: userId, ...details },
        }
    );
}

async function sendReminder(userId, member) {
    const entry = reminders.get(userId);
    if (!entry) return;

    const channel = await fetchChannel(getPresenceChannelId());
    if (!channel) {
        log().warn?.(`[presence-reminder] Salon presence introuvable pour ${userId}`);
        return;
    }

    if (entry.deleteTimerId) clearTimeout(entry.deleteTimerId);
    await deleteLastReminder(entry);

    const absenceChannelId = getAbsenceChannelId();
    const message = await channel.send({
        content: `${member.toString()} 👋 Tu as marqué Absent sur l'OP mais aucune absence n'est posée dans le salon <#${absenceChannelId}>. Merci d'y poser ton absence (template Nom/Prénom/Date(s)/Raison) pour qu'elle soit prise en compte.`,
        allowedMentions: { users: [userId] },
    });

    entry.lastMessageId = message.id;
    entry.lastChannelId = channel.id;
    entry.remindersSent += 1;
    auditReminder('presence.reminder.sent', userId, { reminder_count: entry.remindersSent });

    entry.deleteTimerId = setTimeout(() => {
        deleteLastReminder(entry).catch(e => log().warn?.(`[presence-reminder] Suppression relance echouee: ${e.message}`));
    }, DELETE_REMINDER_DELAY_MS);

    entry.timeoutId = setTimeout(() => {
        checkAndRemind(userId).catch(e => log().warn?.(`[presence-reminder] Relance echouee: ${e.message}`));
    }, NEXT_REMINDER_DELAY_MS);
}

async function checkAndRemind(userId) {
    const entry = reminders.get(userId);
    if (!entry) return;

    if (isPast21hParis()) {
        stopRemindUserAbsence(userId, 'time_up_21h');
        return;
    }

    const cache = await refreshAbsenceCache();
    if (cache?.validAbsences?.has?.(userId)) {
        log().info?.(`[presence-reminder] Relance arretee, absence posee pour ${userId}`);
        stopRemindUserAbsence(userId, 'absence_posted');
        return;
    }

    const member = await fetchMember(userId);
    if (!member) {
        reminders.delete(userId);
        return;
    }

    await sendReminder(userId, member);
}

function registerAbsenceReminder(client, context = {}) {
    clientRef = client;
    contextRef = { ...contextRef, ...context };
    log().info?.('[presence-reminder] Service relance absences initialise');
}

function startRemindUserAbsence(userId) {
    if (!clientRef || !userId || reminders.has(userId)) return;

    const entry = {
        lastMessageId: null,
        lastChannelId: null,
        timeoutId: null,
        deleteTimerId: null,
        remindersSent: 0,
    };

    reminders.set(userId, entry);
    entry.timeoutId = setTimeout(() => {
        checkAndRemind(userId).catch(e => log().warn?.(`[presence-reminder] Check initial echoue: ${e.message}`));
    }, FIRST_CHECK_DELAY_MS);
}

function stopRemindUserAbsence(userId, reason = 'manual') {
    const entry = reminders.get(userId);
    if (!entry) return;

    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    if (entry.deleteTimerId) clearTimeout(entry.deleteTimerId);
    reminders.delete(userId);

    deleteLastReminder(entry).catch(e => log().warn?.(`[presence-reminder] Cleanup relance echoue: ${e.message}`));
    auditReminder('presence.reminder.stopped', userId, { reason });
}

function stopAllReminders(reason = 'new_op_started') {
    for (const userId of [...reminders.keys()]) {
        stopRemindUserAbsence(userId, reason);
    }
}

module.exports = {
    registerAbsenceReminder,
    startRemindUserAbsence,
    stopRemindUserAbsence,
    stopAllReminders,
};
