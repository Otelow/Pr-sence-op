const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const test = require('node:test');

const { memberCanSendToChannel, memberCanViewChannel } = require('../src/web/services/discordPermissions');

function channelWith(flags = []) {
    return {
        permissionsFor(member) {
            if (!member) return null;
            const allowed = new Set(flags);
            return { has: flag => allowed.has(flag) };
        },
    };
}

test('permissions Discord natives couvrent view/send/admin et absence membre', () => {
    const member = { id: 'u1' };
    assert.equal(memberCanViewChannel(channelWith([PermissionFlagsBits.ViewChannel]), member), true);
    assert.equal(memberCanViewChannel(channelWith([]), member), false);
    assert.equal(memberCanViewChannel(null, member), false);
    assert.equal(memberCanViewChannel(channelWith([]), null), false);
    assert.equal(memberCanViewChannel(channelWith([]), member, true), true);

    assert.equal(memberCanSendToChannel(channelWith([PermissionFlagsBits.SendMessages]), member), true);
    assert.equal(memberCanSendToChannel(channelWith([PermissionFlagsBits.SendMessagesInThreads]), member), true);
    assert.equal(memberCanSendToChannel(channelWith([PermissionFlagsBits.ViewChannel]), member), false);
});
