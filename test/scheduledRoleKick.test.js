const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    EXEMPT_USER_IDS,
    EXPIRES_AT_MS,
    KICK_REASON,
    SCHEDULED_AT_MS,
    TARGET_ROLE_ID,
    executeScheduledRoleKick,
    getKickScheduleStatus,
    selectRoleKickTargets,
} = require('../src/bot/services/scheduledRoleKick');

function makeMember(id, roles = []) {
    return {
        id,
        user: { id, bot: false },
        roles: {
            cache: new Map(roles.map(roleId => [roleId, { id: roleId }])),
        },
        kicked: false,
        kickReason: null,
        async kick(reason) {
            this.kicked = true;
            this.kickReason = reason;
        },
    };
}

test('scheduled role kick : selectionne le role cible sauf exemptions', () => {
    const target = makeMember('user-target', [TARGET_ROLE_ID]);
    const exemptA = makeMember(EXEMPT_USER_IDS[0], [TARGET_ROLE_ID]);
    const exemptB = makeMember(EXEMPT_USER_IDS[1], [TARGET_ROLE_ID]);
    const otherRole = makeMember('user-other', ['role-other']);

    const targets = selectRoleKickTargets(new Map([
        [target.id, target],
        [exemptA.id, exemptA],
        [exemptB.id, exemptB],
        [otherRole.id, otherRole],
    ]));

    assert.deepEqual(targets.map(member => member.id), ['user-target']);
});

test('scheduled role kick : fenetre one-shot 31/05/2026 17h15 Paris', () => {
    assert.deepEqual(getKickScheduleStatus(SCHEDULED_AT_MS - 1), { status: 'pending', delayMs: 1 });
    assert.deepEqual(getKickScheduleStatus(SCHEDULED_AT_MS), { status: 'due', delayMs: 0 });
    assert.deepEqual(getKickScheduleStatus(EXPIRES_AT_MS + 1), { status: 'expired', delayMs: 0 });
});

test('scheduled role kick : execute une seule fois et persiste le resultat', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduled-role-kick-'));
    const stateFile = path.join(tmpDir, 'state.json');
    const target = makeMember('user-target', [TARGET_ROLE_ID]);
    const exempt = makeMember(EXEMPT_USER_IDS[1], [TARGET_ROLE_ID]);
    const members = new Map([
        [target.id, target],
        [exempt.id, exempt],
    ]);
    const guild = {
        members: {
            cache: members,
            async fetch() {
                return members;
            },
        },
    };
    const client = {
        guilds: {
            cache: new Map([['guild-1', guild]]),
        },
    };
    const logger = { info() {}, warn() {}, error() {} };

    const firstRun = await executeScheduledRoleKick(client, {
        guildId: 'guild-1',
        logger,
        nowMs: SCHEDULED_AT_MS,
        stateFile,
    });

    assert.equal(firstRun.status, 'executed');
    assert.equal(target.kicked, true);
    assert.equal(target.kickReason, KICK_REASON);
    assert.equal(exempt.kicked, false);
    assert.deepEqual(firstRun.state.kicked, ['user-target']);

    target.kicked = false;
    const secondRun = await executeScheduledRoleKick(client, {
        guildId: 'guild-1',
        logger,
        nowMs: SCHEDULED_AT_MS,
        stateFile,
    });

    assert.equal(secondRun.status, 'already_finalized');
    assert.equal(target.kicked, false);

    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.deepEqual(persisted.kicked, ['user-target']);
});
