const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDecroches, isLikelyCopiedOpRows, wasOpLaunched } = require('../src/web/services/presenceHelpers');

test('wasOpLaunched ignore absentValid et noReaction seuls', () => {
    assert.equal(wasOpLaunched({
        present: 0,
        late: 0,
        absentReact: 0,
        absentValid: 3,
        noReaction: 17,
    }), false);
});

test('computeDecroches retourne vide quand la 2eme OP n a pas ete lancee', () => {
    const decroches = computeDecroches(
        {
            present: [{ user_id: 'u1', username: 'User 1' }],
            late: [{ user_id: 'u2', username: 'User 2' }],
        },
        {
            present: [],
            late: [],
            absentReact: [],
            noReaction: [
                { user_id: 'u1', username: 'User 1' },
                { user_id: 'u2', username: 'User 2' },
            ],
        }
    );

    assert.deepEqual(decroches, []);
});

test('computeDecroches calcule normalement quand la 2eme OP a une reaction active', () => {
    const decroches = computeDecroches(
        {
            present: [{ user_id: 'u1', username: 'User 1' }],
            late: [{ user_id: 'u2', username: 'User 2' }],
        },
        {
            present: [{ user_id: 'u3', username: 'User 3' }],
            late: [],
            absentReact: [{ user_id: 'u1', username: 'User 1' }],
            noReaction: [{ user_id: 'u2', username: 'User 2' }],
        }
    );

    assert.deepEqual(decroches.map(user => user.user_id), ['u1', 'u2']);
});

test('isLikelyCopiedOpRows détecte une OP copiée exactement depuis la veille', () => {
    const previousRows = [
        { user_id: 'u1', status: 'present' },
        { user_id: 'u2', status: 'noReaction' },
    ];
    const currentRows = [
        { user_id: 'u2', status: 'noReaction' },
        { user_id: 'u1', status: 'present' },
    ];

    assert.equal(isLikelyCopiedOpRows(currentRows, previousRows), true);
    assert.equal(isLikelyCopiedOpRows([{ user_id: 'u1', status: 'late' }], previousRows), false);
});
