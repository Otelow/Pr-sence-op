const assert = require('node:assert/strict');
const test = require('node:test');

const { isPresenceDataForDate } = require('../src/bot/services/presenceState');

test('presence snapshot garde uniquement les OP démarrées le jour demandé', () => {
    assert.equal(
        isPresenceDataForDate(
            { messageId: 'op2-old', startedAt: '2026-05-27T20:45:00.000Z' },
            new Map([['u1', new Set(['check'])]]),
            '2026-05-28'
        ),
        false
    );

    assert.equal(
        isPresenceDataForDate(
            { messageId: 'op1-day', startedAt: '2026-05-28T18:45:00.000Z' },
            new Map(),
            '2026-05-28'
        ),
        true
    );
});

test('presence snapshot garde les anciens états sans startedAt par compatibilité', () => {
    assert.equal(
        isPresenceDataForDate(
            { messageId: 'legacy-op' },
            new Map([['u1', new Set(['check'])]]),
            '2026-05-28'
        ),
        true
    );
});
