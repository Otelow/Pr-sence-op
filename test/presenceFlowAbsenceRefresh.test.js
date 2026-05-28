const assert = require('node:assert/strict');
const test = require('node:test');

const { createPresenceFlowService } = require('../src/bot/services/presenceFlow');

function createServiceHarness() {
    const sequence = [];
    let presenceData = { messageId: null, reminderIds: [], reminderInterval: null, active: false, terminated: false, startedAt: null };
    let presence2Data = { messageId: null, active: false, terminated: false, startedAt: null };
    let sentId = 0;

    const channel = {
        id: 'presence-channel',
        guild: {
            members: { cache: { size: 0 }, fetch: async () => null },
            roles: { cache: { get: () => null } },
        },
        send: async () => {
            sequence.push('send');
            sentId += 1;
            return { id: `msg-${sentId}`, createdTimestamp: Date.now() };
        },
        messages: {
            fetch: async () => ({ size: 0 }),
        },
    };

    const service = createPresenceFlowService({
        CONFIG: {
            GUILD_ID: 'guild',
            CHANNELS: { PRESENCE: 'presence-channel', ABSENCE: 'absence-channel', COMMANDES: 'commands' },
            ROLES: { MEMBRE_1: 'role-member', EXCLUDED_ROLE: 'role-excluded', ALERT_ROLE: 'role-alert' },
            EMOJIS: { BS21: ':21bs:', ATTENTION: ':attention:', CHECK: ':check:', RETARD: ':late:', NO: ':no:' },
            REACT_EMOJIS: { CHECK: ':check:', RETARD: ':late:', NO: ':no:' },
        },
        TIMERS: { REMINDER_DELETE_DELAY: 100, PRESENCE_RAPPEL_INTERVAL: 100 },
        PRESENCE_ENABLED: false,
        PRESENCE_CRON: '0 17 * * *',
        TEST_MODE: false,
        TURBO_MODE: false,
        client: { channels: { cache: { get: () => channel } }, guilds: { cache: { get: () => null } }, user: { id: 'bot' } },
        cron: { schedule: () => ({ stop() {} }) },
        sleep: async () => {},
        addPresenceReactions: async () => sequence.push('reactions'),
        reactionsOP1: new Map(),
        reactionsOP2: new Map(),
        getPresenceData: () => presenceData,
        setPresenceData: value => { presenceData = value; },
        getPresence2Data: () => presence2Data,
        setPresence2Data: value => { presence2Data = value; },
        getPresenceItems: () => ['Armes'],
        getCustomPresenceMessage: () => null,
        getAbsenceTracking: () => new Map(),
        loadState: () => '2026-05-28',
        saveState: () => {},
        savePresenceState: () => {},
        getParisDateKey: () => '2026-05-28',
        saveAbsenceTracking: () => {},
        refreshAbsencePanel: async () => sequence.push('panel'),
        stopAbsencePanelRefresh: () => {},
        clearAbsencePanelState: () => {},
        getConsecutiveDays: () => 0,
        stopAllReminders: () => {},
        refreshAbsenceSalonCache: async reason => {
            sequence.push(`refresh:${reason}`);
            return { validAbsences: new Set(['u-absent']) };
        },
    });

    return { service, sequence };
}

test('presence OP1 relit le salon absence avant de poster le message', async () => {
    const { service, sequence } = createServiceHarness();

    await service.sendPresenceMessage();

    assert.deepEqual(sequence.slice(0, 3), ['refresh:presence-op1', 'send', 'reactions']);
});

test('presence OP2 relit le salon absence avant de poster le message', async () => {
    const { service, sequence } = createServiceHarness();

    await service.sendPresence2Message();

    assert.deepEqual(sequence.slice(0, 3), ['refresh:presence-op2', 'send', 'reactions']);
});
