// ANNONCES 28/05/2026 - relance lecture annonces par reaction
const fs = require('fs');
const path = require('path');
const log = require('../../shared/logger');
const config = require('../../shared/config');

const ANNOUNCER_USER_ID = '952986899667103804';
const ANNOUNCEMENT_CHANNEL_ID = '1485636555480502404';
const REMINDER_CHANNEL_ID = '1485651067860680915';
const TARGET_ROLE_ID = '1485270431291277383';
const EXCLUDED_ROLE_ID = '1490361524408291459';
const REMINDER_DELETE_DELAY_MS = 3 * 60 * 1000;
const REMINDER_REPEAT_DELAY_MS = 10 * 60 * 1000;
const INITIAL_REMINDER_DELAY_MS = 1000;
const TRACKING_START_DATE = '2026-05-28';
const TRACKING_START_TIMESTAMP_MS = Date.UTC(2026, 4, 27, 22, 0, 0);
const BACKFILL_MAX_MESSAGES = 500;
const DEFAULT_STATE_FILE = path.join(config.paths.data, 'announcement_reaction_reminders.json');

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

function snowflakeTimestampMs(id) {
    try {
        const snowflake = BigInt(String(id || ''));
        return Number((snowflake >> 22n) + 1420070400000n);
    } catch {
        return null;
    }
}

function getTimestampMs(value) {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
}

function getAnnouncementCreatedTimestampMs(messageOrEntry) {
    return getTimestampMs(messageOrEntry?.createdTimestamp)
        || getTimestampMs(messageOrEntry?.createdAt)
        || snowflakeTimestampMs(messageOrEntry?.id || messageOrEntry?.messageId);
}

function isAnnouncementInTrackingWindow(messageOrEntry, options = {}) {
    const trackingStartMs = Number.isFinite(options.trackingStartMs)
        ? options.trackingStartMs
        : TRACKING_START_TIMESTAMP_MS;
    const timestamp = getAnnouncementCreatedTimestampMs(messageOrEntry);

    if (!timestamp) return true;
    return timestamp >= trackingStartMs;
}

function getAnnouncementCreatedAtIso(message) {
    const timestamp = getAnnouncementCreatedTimestampMs(message);
    return timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
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
        let fullReaction = reaction;

        if (reaction?.partial && typeof reaction.fetch === 'function') {
            fullReaction = await reaction.fetch().catch(() => reaction);
        }

        let users = fullReaction?.users?.cache || fullReaction?.users;

        if (typeof fullReaction?.users?.fetch === 'function') {
            users = await fullReaction.users.fetch({ limit: 100 });
        }

        for (const user of getCollectionValues(users)) {
            if (user?.bot) continue;
            const userId = toId(user?.id);
            if (userId) reacted.add(userId);
        }
    }

    return reacted;
}

async function fetchFreshMessage(channel, messageId) {
    if (!channel?.messages?.fetch) return null;

    let message = await channel.messages.fetch({
        message: toId(messageId),
        force: true,
        cache: true,
    }).catch(() => null);

    if (!message) {
        message = await channel.messages.fetch(toId(messageId)).catch(() => null);
    }

    if (message?.partial && typeof message.fetch === 'function') {
        message = await message.fetch().catch(() => message);
    }

    return message;
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

function serializeEntry(entry) {
    return {
        messageId: toId(entry?.messageId),
        channelId: toId(entry?.channelId),
        lastReminderMessageId: toId(entry?.lastReminderMessageId),
        lastReminderChannelId: toId(entry?.lastReminderChannelId),
        createdAt: entry?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

function loadReminderState(stateFile = DEFAULT_STATE_FILE, logger = log) {
    try {
        if (!fs.existsSync(stateFile)) return [];
        const raw = fs.readFileSync(stateFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.announcements)) return [];

        return parsed.announcements
            .map(item => ({
                messageId: toId(item?.messageId),
                channelId: toId(item?.channelId),
                lastReminderMessageId: toId(item?.lastReminderMessageId),
                lastReminderChannelId: toId(item?.lastReminderChannelId),
                createdAt: item?.createdAt || null,
                updatedAt: item?.updatedAt || null,
                deleteTimerId: null,
                repeatTimerId: null,
            }))
            .filter(item => item.messageId && item.channelId);
    } catch (e) {
        logger.warn?.(`[annonces] lecture suivi annonces impossible: ${e.message}`);
        return [];
    }
}

function saveReminderState(stateFile = DEFAULT_STATE_FILE, logger = log) {
    try {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        const state = {
            savedAt: new Date().toISOString(),
            announcements: [...trackedAnnouncements.values()].map(serializeEntry),
        };
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (e) {
        logger.warn?.(`[annonces] sauvegarde suivi annonces impossible: ${e.message}`);
    }
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
        reminderChannelId: context.reminderChannelId || REMINDER_CHANNEL_ID,
        announcerUserId: context.announcerUserId || ANNOUNCER_USER_ID,
        targetRoleId: context.targetRoleId || TARGET_ROLE_ID,
        excludedRoleId: context.excludedRoleId || EXCLUDED_ROLE_ID,
        attentionEmoji: context.attentionEmoji || ':attention:',
        reminderDeleteDelayMs: context.reminderDeleteDelayMs || REMINDER_DELETE_DELAY_MS,
        reminderRepeatDelayMs: context.reminderRepeatDelayMs || REMINDER_REPEAT_DELAY_MS,
        initialReminderDelayMs: context.initialReminderDelayMs || INITIAL_REMINDER_DELAY_MS,
        trackingStartMs: Number.isFinite(context.trackingStartMs) ? context.trackingStartMs : TRACKING_START_TIMESTAMP_MS,
        backfillMaxMessages: Number.isFinite(context.backfillMaxMessages) ? context.backfillMaxMessages : BACKFILL_MAX_MESSAGES,
        stateFile: context.stateFile || DEFAULT_STATE_FILE,
        logger,
    };

    function persistState() {
        saveReminderState(options.stateFile, logger);
    }

    async function stopAnnouncementReminder(messageId) {
        const entry = trackedAnnouncements.get(toId(messageId));
        if (!entry) return;
        clearEntryTimers(entry);
        trackedAnnouncements.delete(toId(messageId));
        await deleteReminderMessage(client, entry);
        persistState();
    }

    function scheduleNextReminder(entry, delayMs) {
        if (!entry) return;
        if (entry.repeatTimerId) clearTimeout(entry.repeatTimerId);
        entry.repeatTimerId = unrefTimer(setTimeout(() => {
            void checkAndRemind(entry.messageId);
        }, delayMs));
    }

    function trackAnnouncementMessage(message, delayMs = options.initialReminderDelayMs) {
        if (!isAnnouncementTrigger(message, options)) return false;
        if (!isAnnouncementInTrackingWindow(message, options)) return false;

        const messageId = toId(message.id);
        if (!messageId || trackedAnnouncements.has(messageId)) return false;

        const entry = {
            messageId,
            channelId: toId(message.channelId),
            lastReminderMessageId: null,
            lastReminderChannelId: null,
            createdAt: getAnnouncementCreatedAtIso(message),
            updatedAt: new Date().toISOString(),
            deleteTimerId: null,
            repeatTimerId: null,
        };

        trackedAnnouncements.set(messageId, entry);
        persistState();
        scheduleNextReminder(entry, delayMs);
        return true;
    }

    async function checkAndRemind(messageId) {
        const entry = trackedAnnouncements.get(toId(messageId));
        if (!entry) return;

        try {
            const channel = await client.channels.fetch(entry.channelId).catch(() => null);
            const announcement = await fetchFreshMessage(channel, entry.messageId);

            if (!channel || !announcement) {
                logger.info?.(`[annonces] annonce ${entry.messageId} introuvable, relance arretee`);
                await stopAnnouncementReminder(entry.messageId);
                return;
            }

            if (!isAnnouncementInTrackingWindow(announcement, options)) {
                logger.info?.(`[annonces] annonce ${entry.messageId} avant ${TRACKING_START_DATE}, relance ignoree`);
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

            const reminderChannel = toId(options.reminderChannelId) === toId(entry.channelId)
                ? channel
                : await client.channels.fetch(options.reminderChannelId).catch(() => null);

            if (!reminderChannel?.send) {
                logger.warn?.(`[annonces] salon de relance ${options.reminderChannelId} introuvable`);
                scheduleNextReminder(entry, options.reminderRepeatDelayMs);
                return;
            }

            const userIds = nonReactors.map(member => getMemberId(member)).filter(Boolean);
            const mentions = userIds.map(userId => `<@${userId}>`).join(' ');
            const reminder = await reminderChannel.send({
                content: `${mentions} Merci de lire et de réagir à l'annonce (<#${options.channelId}>) On ne fait pas d'annonce pour le plaisir ${options.attentionEmoji}`,
                allowedMentions: { users: userIds },
            });

            entry.lastReminderMessageId = reminder.id;
            entry.lastReminderChannelId = reminder.channelId || reminderChannel.id;
            persistState();

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
        return trackAnnouncementMessage(message, options.initialReminderDelayMs);
    }

    function restoreTrackedAnnouncements() {
        const entries = loadReminderState(options.stateFile, logger);
        let restored = 0;
        let skipped = 0;

        for (const entry of entries) {
            if (!isAnnouncementInTrackingWindow(entry, options)) {
                skipped += 1;
                continue;
            }
            if (trackedAnnouncements.has(entry.messageId)) continue;
            trackedAnnouncements.set(entry.messageId, entry);
            scheduleNextReminder(entry, options.initialReminderDelayMs);
            restored += 1;
        }

        if (restored > 0) {
            logger.info?.(`[annonces] ${restored} annonce(s) restauree(s) apres redemarrage`);
        }
        if (skipped > 0) {
            logger.info?.(`[annonces] ${skipped} annonce(s) avant ${TRACKING_START_DATE} ignoree(s)`);
            persistState();
        }

        return restored;
    }

    async function backfillAnnouncementMessages() {
        const channel = await client.channels.fetch(options.channelId).catch(() => null);

        if (!channel?.messages?.fetch) {
            logger.warn?.(`[annonces] salon annonce ${options.channelId} introuvable pour reprise historique`);
            return 0;
        }

        let backfilled = 0;
        let scanned = 0;
        let before = null;
        let reachedBeforeStart = false;

        while (scanned < options.backfillMaxMessages && !reachedBeforeStart) {
            const limit = Math.min(100, options.backfillMaxMessages - scanned);
            const query = before ? { limit, before } : { limit };
            const batch = await channel.messages.fetch(query).catch(e => {
                logger.warn?.(`[annonces] lecture historique annonces impossible: ${e.message}`);
                return null;
            });
            const messages = getCollectionValues(batch);

            if (messages.length === 0) break;

            messages.sort((a, b) => {
                return (getAnnouncementCreatedTimestampMs(b) || 0) - (getAnnouncementCreatedTimestampMs(a) || 0);
            });

            for (const message of messages) {
                scanned += 1;
                const timestamp = getAnnouncementCreatedTimestampMs(message);

                if (timestamp && timestamp < options.trackingStartMs) {
                    reachedBeforeStart = true;
                    continue;
                }

                if (trackAnnouncementMessage(message, options.initialReminderDelayMs)) {
                    backfilled += 1;
                }
            }

            before = toId(messages[messages.length - 1]?.id);
            if (!before || messages.length < limit) break;
        }

        if (backfilled > 0) {
            logger.info?.(`[annonces] ${backfilled} annonce(s) reprise(s) depuis l'historique`);
        }

        return backfilled;
    }

    async function bootstrapTracking() {
        const restored = restoreTrackedAnnouncements();
        let backfilled = 0;

        try {
            backfilled = await backfillAnnouncementMessages();
        } catch (e) {
            logger.error?.(`[annonces] reprise historique echouee: ${e.message}`);
        }

        return { restored, backfilled };
    }

    client.on('messageCreate', message => {
        try {
            startAnnouncementReminder(message);
        } catch (e) {
            logger.error?.(`[annonces] detection annonce echouee: ${e.message}`);
        }
    });

    if (typeof client.isReady === 'function' && client.isReady()) {
        void bootstrapTracking();
    } else if (typeof client.once === 'function') {
        client.once('ready', () => {
            void bootstrapTracking();
        });
    }

    return {
        backfillAnnouncementMessages,
        bootstrapTracking,
        restoreTrackedAnnouncements,
        startAnnouncementReminder,
        stopAnnouncementReminder,
        checkAndRemind,
    };
}

module.exports = {
    ANNOUNCER_USER_ID,
    ANNOUNCEMENT_CHANNEL_ID,
    BACKFILL_MAX_MESSAGES,
    REMINDER_CHANNEL_ID,
    TARGET_ROLE_ID,
    EXCLUDED_ROLE_ID,
    REMINDER_DELETE_DELAY_MS,
    REMINDER_REPEAT_DELAY_MS,
    TRACKING_START_DATE,
    TRACKING_START_TIMESTAMP_MS,
    getAnnouncementCreatedTimestampMs,
    getAnnouncementNonReactors,
    getReactedUserIds,
    isAnnouncementTrigger,
    isAnnouncementInTrackingWindow,
    loadReminderState,
    memberHasRole,
    registerAnnouncementReactionReminder,
    saveReminderState,
};
