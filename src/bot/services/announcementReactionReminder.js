// ANNONCES 28/05/2026 - relance lecture annonces par reaction
const log = require('../../shared/logger');

const ANNOUNCER_USER_ID = '952986899667103804';
const ANNOUNCEMENT_CHANNEL_ID = '1485636555480502404';
const TARGET_ROLE_ID = '1485270431291277383';
const EXCLUDED_ROLE_ID = '1490361524408291459';
const REMINDER_DELETE_DELAY_MS = 3 * 60 * 1000;
const REMINDER_REPEAT_DELAY_MS = 3 * 60 * 1000;
const INITIAL_REMINDER_DELAY_MS = 1000;

const trackedAnnouncements = new Map();

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

function isAnnouncementTrigger(message, options = {}) {
    const channelId = toId(options.channelId || ANNOUNCEMENT_CHANNEL_ID);
    const authorId = toId(options.announcerUserId || ANNOUNCER_USER_ID);
    return Boolean(
        message
        && !message.author?.bot
        && toId(message.channelId) === channelId
        && toId(message.author?.id) === authorId
    );
}

async function fetchGuildMembers(guild, logger = log) {
    if (!guild?.members) return [];

    try {
        if (typeof guild.members.fetch === 'function') {
            await guild.members.fetch();
        }
    } catch (e) {
        logger.warn?.(`[annonces] refresh membres impossible, cache utilise: ${e.message}`);
    }

    return getCollectionValues(guild.members.cache || guild.members);
}

async function getReactedUserIds(message) {
    const reacted = new Set();
    const reactions = getCollectionValues(message?.reactions?.cache || message?.reactions);

    for (const reaction of reactions) {
        let users = reaction?.users?.cache || reaction?.users;

        if (typeof reaction?.users?.fetch === 'function') {
            users = await reaction.users.fetch();
        }

        for (const user of getCollectionValues(users)) {
            if (user?.bot) continue;
            const userId = toId(user?.id);
            if (userId) reacted.add(userId);
        }
    }

    return reacted;
}

async function getAnnouncementNonReactors(guild, message, options = {}) {
    const targetRoleId = toId(options.targetRoleId || TARGET_ROLE_ID);
    const excludedRoleId = toId(options.excludedRoleId || EXCLUDED_ROLE_ID);
    const members = await fetchGuildMembers(guild, options.logger || log);
    const reacted = await getReactedUserIds(message);

    return members.filter(member => {
        const memberId = getMemberId(member);
        if (!memberId || member.user?.bot) return false;
        if (!memberHasRole(member, targetRoleId)) return false;
        if (excludedRoleId && memberHasRole(member, excludedRoleId)) return false;
        return !reacted.has(memberId);
    });
}

function clearEntryTimers(entry) {
    if (!entry) return;
    if (entry.deleteTimerId) clearTimeout(entry.deleteTimerId);
    if (entry.repeatTimerId) clearTimeout(entry.repeatTimerId);
    entry.deleteTimerId = null;
    entry.repeatTimerId = null;
}

function unrefTimer(timer) {
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
}

async function deleteReminderMessage(client, entry) {
    if (!entry?.lastReminderMessageId || !entry.lastReminderChannelId) return;

    try {
        const channel = await client.channels.fetch(entry.lastReminderChannelId).catch(() => null);
        const message = await channel?.messages?.fetch(entry.lastReminderMessageId).catch(() => null);
        await message?.delete?.().catch(() => {});
    } catch (e) {
        log.debug?.(`[annonces] suppression rappel impossible: ${e.message}`);
    }

    entry.lastReminderMessageId = null;
    entry.lastReminderChannelId = null;
}

function registerAnnouncementReactionReminder(client, context = {}) {
    const logger = context.logger || log;
    const options = {
        channelId: context.channelId || ANNOUNCEMENT_CHANNEL_ID,
        announcerUserId: context.announcerUserId || ANNOUNCER_USER_ID,
        targetRoleId: context.targetRoleId || TARGET_ROLE_ID,
        excludedRoleId: context.excludedRoleId || EXCLUDED_ROLE_ID,
        attentionEmoji: context.attentionEmoji || ':attention:',
        reminderDeleteDelayMs: context.reminderDeleteDelayMs || REMINDER_DELETE_DELAY_MS,
        reminderRepeatDelayMs: context.reminderRepeatDelayMs || REMINDER_REPEAT_DELAY_MS,
        initialReminderDelayMs: context.initialReminderDelayMs || INITIAL_REMINDER_DELAY_MS,
        logger,
    };

    async function stopAnnouncementReminder(messageId) {
        const entry = trackedAnnouncements.get(toId(messageId));
        if (!entry) return;
        clearEntryTimers(entry);
        trackedAnnouncements.delete(toId(messageId));
        await deleteReminderMessage(client, entry);
    }

    function scheduleNextReminder(entry, delayMs) {
        if (!entry) return;
        if (entry.repeatTimerId) clearTimeout(entry.repeatTimerId);
        entry.repeatTimerId = unrefTimer(setTimeout(() => {
            void checkAndRemind(entry.messageId);
        }, delayMs));
    }

    async function checkAndRemind(messageId) {
        const entry = trackedAnnouncements.get(toId(messageId));
        if (!entry) return;

        try {
            const channel = await client.channels.fetch(entry.channelId).catch(() => null);
            const announcement = await channel?.messages?.fetch(entry.messageId).catch(() => null);

            if (!channel || !announcement) {
                logger.info?.(`[annonces] annonce ${entry.messageId} introuvable, relance arretee`);
                await stopAnnouncementReminder(entry.messageId);
                return;
            }

            const guild = announcement.guild || channel.guild;
            const nonReactors = await getAnnouncementNonReactors(guild, announcement, options);

            if (nonReactors.length === 0) {
                logger.info?.(`[annonces] tout le monde a reagi a ${entry.messageId}, relance arretee`);
                await stopAnnouncementReminder(entry.messageId);
                return;
            }

            await deleteReminderMessage(client, entry);

            const userIds = nonReactors.map(member => getMemberId(member)).filter(Boolean);
            const mentions = userIds.map(userId => `<@${userId}>`).join(' ');
            const reminder = await channel.send({
                content: `${mentions} Merci de lire et de réagir à l'annonce (<#${options.channelId}>) On ne fait pas d'annonce pour le plaisir ${options.attentionEmoji}`,
                allowedMentions: { users: userIds },
            });

            entry.lastReminderMessageId = reminder.id;
            entry.lastReminderChannelId = reminder.channelId || channel.id;

            if (entry.deleteTimerId) clearTimeout(entry.deleteTimerId);
            entry.deleteTimerId = unrefTimer(setTimeout(() => {
                void deleteReminderMessage(client, entry);
            }, options.reminderDeleteDelayMs));

            scheduleNextReminder(entry, options.reminderRepeatDelayMs);
        } catch (e) {
            logger.error?.(`[annonces] relance reaction annonce echouee: ${e.message}`);
            scheduleNextReminder(entry, options.reminderRepeatDelayMs);
        }
    }

    function startAnnouncementReminder(message) {
        if (!isAnnouncementTrigger(message, options)) return false;

        const messageId = toId(message.id);
        if (!messageId) return false;

        const existing = trackedAnnouncements.get(messageId);
        if (existing) clearEntryTimers(existing);

        const entry = {
            messageId,
            channelId: toId(message.channelId),
            lastReminderMessageId: null,
            lastReminderChannelId: null,
            deleteTimerId: null,
            repeatTimerId: null,
        };

        trackedAnnouncements.set(messageId, entry);
        scheduleNextReminder(entry, options.initialReminderDelayMs);
        return true;
    }

    client.on('messageCreate', message => {
        try {
            startAnnouncementReminder(message);
        } catch (e) {
            logger.error?.(`[annonces] detection annonce echouee: ${e.message}`);
        }
    });

    return {
        startAnnouncementReminder,
        stopAnnouncementReminder,
        checkAndRemind,
    };
}

module.exports = {
    ANNOUNCER_USER_ID,
    ANNOUNCEMENT_CHANNEL_ID,
    TARGET_ROLE_ID,
    EXCLUDED_ROLE_ID,
    REMINDER_DELETE_DELAY_MS,
    REMINDER_REPEAT_DELAY_MS,
    getAnnouncementNonReactors,
    getReactedUserIds,
    isAnnouncementTrigger,
    memberHasRole,
    registerAnnouncementReactionReminder,
};
