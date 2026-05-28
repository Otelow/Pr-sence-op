const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    ANNOUNCEMENT_CHANNEL_ID,
    ANNOUNCER_USER_ID,
    EXCLUDED_ROLE_ID,
    REMINDER_CHANNEL_ID,
    REMINDER_REPEAT_DELAY_MS,
    TARGET_ROLE_ID,
    TRACKING_START_DATE,
    TRACKING_START_TIMESTAMP_MS,
    getAnnouncementNonReactors,
    isAnnouncementInTrackingWindow,
    isAnnouncementTrigger,
    memberHasRole,
    registerAnnouncementReactionReminder,
} = require('../src/bot/services/announcementReactionReminder');

function makeMember(id, roles = [], bot = false) {
    return {
        id,
        user: { id, bot },
        roles: {
            cache: new Map(roles.map(roleId => [roleId, { id: roleId }])),
        },
    };
}

function makeReactionUsers(userIds) {
    return new Map(userIds.map(userId => [userId, { id: userId, bot: false }]));
}

test('annonce reactions : detecte seulement le bon auteur dans le bon salon', () => {
    assert.equal(isAnnouncementTrigger({
        id: 'message-1',
        channelId: ANNOUNCEMENT_CHANNEL_ID,
        author: { id: ANNOUNCER_USER_ID, bot: false },
    }), true);

    assert.equal(isAnnouncementTrigger({
        id: 'message-2',
        channelId: 'autre-salon',
        author: { id: ANNOUNCER_USER_ID, bot: false },
    }), false);

    assert.equal(isAnnouncementTrigger({
        id: 'message-3',
        channelId: ANNOUNCEMENT_CHANNEL_ID,
        author: { id: 'autre-user', bot: false },
    }), false);
});

test('annonce reactions : lecture des roles Discord', () => {
    const member = makeMember('user-1', [TARGET_ROLE_ID]);
    assert.equal(memberHasRole(member, TARGET_ROLE_ID), true);
    assert.equal(memberHasRole(member, EXCLUDED_ROLE_ID), false);
});

test('annonce reactions : relance toutes les 10 minutes et ignore avant le 28/05/2026', () => {
    assert.equal(REMINDER_REPEAT_DELAY_MS, 10 * 60 * 1000);
    assert.equal(TRACKING_START_DATE, '2026-05-28');
    assert.equal(isAnnouncementInTrackingWindow({
        createdAt: new Date(TRACKING_START_TIMESTAMP_MS - 1).toISOString(),
    }), false);
    assert.equal(isAnnouncementInTrackingWindow({
        createdAt: new Date(TRACKING_START_TIMESTAMP_MS).toISOString(),
    }), true);
});

test('annonce reactions : calcule uniquement les membres a relancer', async () => {
    const shouldPing = makeMember('user-ping', [TARGET_ROLE_ID]);
    const alreadyReacted = makeMember('user-reacted', [TARGET_ROLE_ID]);
    const excluded = makeMember('user-excluded', [TARGET_ROLE_ID, EXCLUDED_ROLE_ID]);
    const noTargetRole = makeMember('user-other-role', ['role-other']);
    const bot = makeMember('bot-user', [TARGET_ROLE_ID], true);

    const members = new Map([
        [shouldPing.id, shouldPing],
        [alreadyReacted.id, alreadyReacted],
        [excluded.id, excluded],
        [noTargetRole.id, noTargetRole],
        [bot.id, bot],
    ]);

    const guild = {
        members: {
            cache: members,
            async fetch() {
                return members;
            },
        },
    };

    const message = {
        reactions: {
            cache: new Map([
                ['check', {
                    users: {
                        async fetch() {
                            return makeReactionUsers(['user-reacted']);
                        },
                    },
                }],
            ]),
        },
    };

    const nonReactors = await getAnnouncementNonReactors(guild, message, {
        targetRoleId: TARGET_ROLE_ID,
        excludedRoleId: EXCLUDED_ROLE_ID,
        logger: { warn() {} },
    });

    assert.deepEqual(nonReactors.map(member => member.id), ['user-ping']);
});

test('annonce reactions : envoie les relances dans le salon dedie', async () => {
    const shouldPing = makeMember('user-ping', [TARGET_ROLE_ID]);
    const members = new Map([[shouldPing.id, shouldPing]]);
    const guild = {
        members: {
            cache: members,
            async fetch() {
                return members;
            },
        },
    };

    const announcement = {
        id: 'announcement-1',
        guild,
        reactions: { cache: new Map() },
    };

    const sent = [];
    const announcementChannel = {
        id: ANNOUNCEMENT_CHANNEL_ID,
        guild,
        messages: {
            async fetch(id) {
                return id === announcement.id ? announcement : null;
            },
        },
        async send() {
            throw new Error('La relance ne doit pas partir dans le salon annonce');
        },
    };
    const reminderChannel = {
        id: REMINDER_CHANNEL_ID,
        guild,
        messages: {
            async fetch() {
                return null;
            },
        },
        async send(payload) {
            sent.push(payload);
            return { id: 'reminder-1', channelId: REMINDER_CHANNEL_ID, delete: async () => {} };
        },
    };
    const channels = new Map([
        [ANNOUNCEMENT_CHANNEL_ID, announcementChannel],
        [REMINDER_CHANNEL_ID, reminderChannel],
    ]);

    const listeners = new Map();
    const client = {
        on(event, handler) {
            listeners.set(event, handler);
        },
        channels: {
            async fetch(id) {
                return channels.get(id) || null;
            },
        },
    };

    const service = registerAnnouncementReactionReminder(client, {
        logger: { info() {}, warn() {}, error() {} },
        attentionEmoji: ':attention:',
        initialReminderDelayMs: 60_000,
        reminderDeleteDelayMs: 60_000,
        reminderRepeatDelayMs: 60_000,
    });

    service.startAnnouncementReminder({
        id: announcement.id,
        channelId: ANNOUNCEMENT_CHANNEL_ID,
        author: { id: ANNOUNCER_USER_ID, bot: false },
    });

    await service.checkAndRemind(announcement.id);
    await service.stopAnnouncementReminder(announcement.id);

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { users: ['user-ping'] });
    assert.match(sent[0].content, new RegExp(`<#${ANNOUNCEMENT_CHANNEL_ID}>`));
});

test('annonce reactions : reprend le suivi apres redemarrage', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'announcement-reminders-'));
    const stateFile = path.join(tmpDir, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify({
        announcements: [{
            messageId: 'announcement-restart',
            channelId: ANNOUNCEMENT_CHANNEL_ID,
            createdAt: '2026-05-28T18:00:00.000Z',
        }],
    }));

    const shouldPing = makeMember('user-restart', [TARGET_ROLE_ID]);
    const members = new Map([[shouldPing.id, shouldPing]]);
    const guild = {
        members: {
            cache: members,
            async fetch() {
                return members;
            },
        },
    };
    const announcement = {
        id: 'announcement-restart',
        guild,
        reactions: { cache: new Map() },
    };

    const sent = [];
    const channels = new Map([
        [ANNOUNCEMENT_CHANNEL_ID, {
            id: ANNOUNCEMENT_CHANNEL_ID,
            guild,
            messages: {
                async fetch(id) {
                    return id === announcement.id ? announcement : null;
                },
            },
        }],
        [REMINDER_CHANNEL_ID, {
            id: REMINDER_CHANNEL_ID,
            guild,
            messages: {
                async fetch() {
                    return null;
                },
            },
            async send(payload) {
                sent.push(payload);
                return { id: 'restart-reminder', channelId: REMINDER_CHANNEL_ID, delete: async () => {} };
            },
        }],
    ]);

    let readyHandler = null;
    const client = {
        on() {},
        once(event, handler) {
            if (event === 'ready') readyHandler = handler;
        },
        channels: {
            async fetch(id) {
                return channels.get(id) || null;
            },
        },
    };

    const service = registerAnnouncementReactionReminder(client, {
        stateFile,
        logger: { info() {}, warn() {}, error() {} },
        attentionEmoji: ':attention:',
        initialReminderDelayMs: 60_000,
        reminderDeleteDelayMs: 60_000,
        reminderRepeatDelayMs: 60_000,
    });

    assert.equal(typeof readyHandler, 'function');
    assert.deepEqual(await service.bootstrapTracking(), { restored: 1, backfilled: 0 });

    await service.checkAndRemind(announcement.id);
    await service.stopAnnouncementReminder(announcement.id);

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { users: ['user-restart'] });

    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.deepEqual(persisted.announcements, []);
});

test('annonce reactions : ne restaure pas les annonces avant le 28/05/2026', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'announcement-reminders-old-'));
    const stateFile = path.join(tmpDir, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify({
        announcements: [{
            messageId: 'announcement-old',
            channelId: ANNOUNCEMENT_CHANNEL_ID,
            createdAt: new Date(TRACKING_START_TIMESTAMP_MS - 1).toISOString(),
        }],
    }));

    let readyHandler = null;
    const client = {
        on() {},
        once(event, handler) {
            if (event === 'ready') readyHandler = handler;
        },
        channels: {
            async fetch() {
                throw new Error('Une annonce trop ancienne ne doit pas etre refetch');
            },
        },
    };

    const service = registerAnnouncementReactionReminder(client, {
        stateFile,
        logger: { info() {}, warn() {}, error() {} },
        attentionEmoji: ':attention:',
        initialReminderDelayMs: 60_000,
        reminderDeleteDelayMs: 60_000,
        reminderRepeatDelayMs: 60_000,
    });

    assert.equal(typeof readyHandler, 'function');
    assert.deepEqual(await service.bootstrapTracking(), { restored: 0, backfilled: 0 });

    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.deepEqual(persisted.announcements, []);
});

test('annonce reactions : reprend une annonce existante depuis l historique du salon', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'announcement-reminders-backfill-'));
    const stateFile = path.join(tmpDir, 'state.json');
    const announcementId = '1509643000505176124';
    const shouldPing = makeMember('user-backfill', [TARGET_ROLE_ID]);
    const members = new Map([[shouldPing.id, shouldPing]]);
    const guild = {
        members: {
            cache: members,
            async fetch() {
                return members;
            },
        },
    };
    const announcement = {
        id: announcementId,
        channelId: ANNOUNCEMENT_CHANNEL_ID,
        author: { id: ANNOUNCER_USER_ID, bot: false },
        guild,
        reactions: { cache: new Map() },
    };

    const sent = [];
    const announcementChannel = {
        id: ANNOUNCEMENT_CHANNEL_ID,
        guild,
        messages: {
            async fetch(arg) {
                if (typeof arg === 'string') return arg === announcementId ? announcement : null;
                return new Map([[announcementId, announcement]]);
            },
        },
    };
    const reminderChannel = {
        id: REMINDER_CHANNEL_ID,
        guild,
        messages: {
            async fetch() {
                return null;
            },
        },
        async send(payload) {
            sent.push(payload);
            return { id: 'backfill-reminder', channelId: REMINDER_CHANNEL_ID, delete: async () => {} };
        },
    };
    const channels = new Map([
        [ANNOUNCEMENT_CHANNEL_ID, announcementChannel],
        [REMINDER_CHANNEL_ID, reminderChannel],
    ]);
    const client = {
        on() {},
        channels: {
            async fetch(id) {
                return channels.get(id) || null;
            },
        },
    };

    const service = registerAnnouncementReactionReminder(client, {
        stateFile,
        logger: { info() {}, warn() {}, error() {} },
        attentionEmoji: ':attention:',
        initialReminderDelayMs: 60_000,
        reminderDeleteDelayMs: 60_000,
        reminderRepeatDelayMs: 60_000,
        backfillMaxMessages: 10,
    });

    assert.equal(await service.backfillAnnouncementMessages(), 1);

    const persistedAfterBackfill = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(persistedAfterBackfill.announcements[0].messageId, announcementId);

    await service.checkAndRemind(announcementId);
    await service.stopAnnouncementReminder(announcementId);

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { users: ['user-backfill'] });
});
