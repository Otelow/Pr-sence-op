const assert = require('node:assert/strict');
const test = require('node:test');
const { createReactionRestoreService } = require('../src/bot/services/reactionRestore');

function makeCollection(entries) {
    const map = new Map(entries);
    map.lastKey = () => entries.at(-1)?.[0];
    return map;
}

test('restoreReactionsFromMessage force le fetch Discord et pagine tous les users', async () => {
    const fetchCalls = [];
    const reactionMap = new Map([['old-user', new Set(['check'])]]);
    const reaction = {
        emoji: { name: 'check', id: '1486393925219647519' },
        users: {
            fetch: async (options = {}) => {
                fetchCalls.push(options);
                if (!options.after) {
                    return makeCollection(
                        Array.from({ length: 100 }, (_, i) => [`u${i}`, { bot: false }]),
                    );
                }
                return makeCollection([
                    ['u100', { bot: false }],
                    ['bot-user', { bot: true }],
                ]);
            },
        },
    };

    const messageFetchCalls = [];
    const channel = {
        messages: {
            fetch: async options => {
                messageFetchCalls.push(options);
                return { reactions: { cache: new Map([['check', reaction]]) } };
            },
        },
    };

    const service = createReactionRestoreService({
        CONFIG: { CHANNELS: { PRESENCE: 'presence-channel' } },
        client: { channels: { cache: new Map([['presence-channel', channel]]) } },
        emojiToType: (name, id) => (name === 'check' && id ? 'check' : null),
    });

    const restored = await service.restoreReactionsFromMessage('message-1', reactionMap);

    assert.equal(restored, true);
    assert.deepEqual(messageFetchCalls, [{ message: 'message-1', cache: false, force: true }]);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0].limit, 100);
    assert.equal(fetchCalls[1].after, 'u99');
    assert.equal(reactionMap.has('old-user'), false);
    assert.equal(reactionMap.size, 101);
    assert.equal(reactionMap.get('u100').has('check'), true);
    assert.equal(reactionMap.has('bot-user'), false);
});
