const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/shared/config');
const {
    isBypassUser,
    isInAllowedChannel,
    maybeRemindClipForum,
} = require('../src/bot/events/clips');

function withClipsConfig(overrides, fn) {
    const previous = {
        allowedChannelIds: config.clips.allowedChannelIds,
        bypassUserIds: config.clips.bypassUserIds,
    };
    Object.assign(config.clips, overrides);
    return Promise.resolve()
        .then(fn)
        .finally(() => Object.assign(config.clips, previous));
}

function makeMessage({ userId = 'user-1', channelId = 'channel-1' } = {}) {
    return {
        author: { id: userId, bot: false },
        channelId,
        channel: { parentId: 'category-1' },
        content: 'https://example.com/video.mp4',
        attachments: new Map(),
        deletable: true,
        deleteCalled: false,
        replyCalled: false,
        async delete() {
            this.deleteCalled = true;
        },
        async reply() {
            this.replyCalled = true;
        },
    };
}

test('clips bypass : salon whitelist direct reconnu', () => withClipsConfig({
    allowedChannelIds: ['1486729752479006770'],
    bypassUserIds: [],
}, () => {
    assert.equal(isInAllowedChannel(makeMessage({ channelId: '1486729752479006770' })), true);
    assert.equal(isInAllowedChannel(makeMessage({ channelId: 'other-channel' })), false);
}));

test('clips bypass : utilisateur exempt reconnu', () => withClipsConfig({
    allowedChannelIds: [],
    bypassUserIds: ['952986899667103804'],
}, () => {
    assert.equal(isBypassUser(makeMessage({ userId: '952986899667103804' })), true);
    assert.equal(isBypassUser(makeMessage({ userId: 'user-2' })), false);
}));

test('clips bypass : aucun rappel ni suppression pour user exempt ou salon whitelist', async () => {
    await withClipsConfig({
        allowedChannelIds: ['allowed-channel'],
        bypassUserIds: ['bypass-user'],
    }, async () => {
        const bypassMessage = makeMessage({ userId: 'bypass-user', channelId: 'blocked-channel' });
        await maybeRemindClipForum(bypassMessage);
        assert.equal(bypassMessage.deleteCalled, false);
        assert.equal(bypassMessage.replyCalled, false);

        const allowedMessage = makeMessage({ userId: 'normal-user', channelId: 'allowed-channel' });
        await maybeRemindClipForum(allowedMessage);
        assert.equal(allowedMessage.deleteCalled, false);
        assert.equal(allowedMessage.replyCalled, false);
    });
});
