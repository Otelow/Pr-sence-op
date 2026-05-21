const test = require('node:test');
const assert = require('node:assert/strict');
const { collectNoReactionMembers } = require('../src/bot/services/presenceNoReaction');

function member(id, { bot = false, excluded = false } = {}) {
    return {
        id,
        user: { bot, username: id },
        roles: { cache: { has: roleId => excluded && roleId === 'excluded-role' } },
    };
}

function roleWithMembers(...members) {
    return { members: new Map(members.map(m => [m.id, m])) };
}

test('OP avec plusieurs réactions ignore les membres qui ont réagi', () => {
    const role = roleWithMembers(member('u1'), member('u2'), member('u3'));
    const result = collectNoReactionMembers({
        role,
        reactionMap: new Map([['u1', new Set(['check'])], ['u2', new Set(['retard'])]]),
        validAbsences: new Set(),
        invalidAbsences: new Set(),
        excludedRoleId: 'excluded-role',
    });
    assert.deepEqual(result.noReact.map(m => m.id), ['u3']);
    assert.deepEqual([...result.reacted].sort(), ['u1', 'u2']);
});

test('OP sans aucune réaction marque tous les membres éligibles non-réactifs', () => {
    const role = roleWithMembers(member('u1'), member('u2'));
    const result = collectNoReactionMembers({
        role,
        reactionMap: new Map(),
        validAbsences: new Set(),
        invalidAbsences: new Set(),
        excludedRoleId: 'excluded-role',
    });
    assert.deepEqual(result.noReact.map(m => m.id), ['u1', 'u2']);
    assert.equal(result.reacted.size, 0);
});

test('OP respecte absences valides, absences invalides, bots et rôle exclu', () => {
    const role = roleWithMembers(
        member('valid'),
        member('invalid'),
        member('bot', { bot: true }),
        member('excluded', { excluded: true }),
        member('remaining'),
    );
    const result = collectNoReactionMembers({
        role,
        reactionMap: null,
        validAbsences: new Set(['valid']),
        invalidAbsences: new Set(['invalid']),
        excludedRoleId: 'excluded-role',
    });
    assert.deepEqual(result.noReact.map(m => m.id), ['remaining']);
});
