const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getCurrentPresenceLive,
    getMondayBeforeParis,
    getMondayParis,
} = require('../src/web/services/dashboardOverview');

function makeMember(id, { bot = false, excluded = false } = {}) {
    return {
        id,
        user: { bot },
        roles: {
            cache: {
                has: roleId => excluded && roleId === 'excluded-role',
            },
        },
    };
}

function makeClient(members) {
    return {
        guilds: {
            cache: new Map([
                ['guild-1', {
                    roles: {
                        cache: new Map([
                            ['member-role', { members: new Map(members.map(member => [member.id, member])) }],
                        ]),
                    },
                }],
            ]),
        },
    };
}

test('Command Center overview : presence live agrege OP1, absences, exclusions et decroches', () => {
    const client = makeClient([
        makeMember('u1'),
        makeMember('u2'),
        makeMember('u3'),
        makeMember('bot', { bot: true }),
        makeMember('excluded', { excluded: true }),
    ]);
    const state = {
        CONFIG: {
            GUILD_ID: 'guild-1',
            ROLES: {
                MEMBRE_1: 'member-role',
                EXCLUDED_ROLE: 'excluded-role',
            },
        },
        absenceSalonCache: { validAbsences: new Set(['u3']) },
        reactionsOP1: new Map([
            ['u1', new Set(['check'])],
            ['u2', new Set(['retard'])],
        ]),
        reactionsOP2: new Map([
            ['u1', new Set(['no'])],
            ['u2', new Set(['check'])],
        ]),
        presence2Data: { active: true, messageId: 'message-2' },
    };

    assert.deepEqual(getCurrentPresenceLive(client, state), {
        total: 3,
        presents: 1,
        retards: 1,
        absentsJustifies: 1,
        decroches: 1,
        op2Launched: true,
    });
});

test('Command Center overview : aucun decroche si la 2eme OP n a pas de reaction active', () => {
    const client = makeClient([
        makeMember('u1'),
        makeMember('u2'),
    ]);
    const state = {
        CONFIG: {
            GUILD_ID: 'guild-1',
            ROLES: {
                MEMBRE_1: 'member-role',
                EXCLUDED_ROLE: 'excluded-role',
            },
        },
        absenceSalonCache: { validAbsences: new Set() },
        reactionsOP1: new Map([
            ['u1', new Set(['check'])],
            ['u2', new Set(['retard'])],
        ]),
        reactionsOP2: new Map(),
        presence2Data: { active: true, messageId: 'message-2' },
    };

    assert.deepEqual(getCurrentPresenceLive(client, state), {
        total: 2,
        presents: 1,
        retards: 1,
        absentsJustifies: 0,
        decroches: 0,
        op2Launched: false,
    });
});

test('Command Center overview : lundi Paris courant et precedent', () => {
    const date = new Date('2026-05-21T10:00:00Z');
    assert.equal(getMondayParis(date), '2026-05-18');
    assert.equal(getMondayBeforeParis(date), '2026-05-11');
});
