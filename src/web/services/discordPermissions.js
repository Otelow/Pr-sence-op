// AUDIT HARDENING 21/05/2026 - permissions Discord via API native discord.js
const { PermissionFlagsBits } = require('discord.js');

function getNativePermissions(channel, member) {
    if (!channel?.permissionsFor || !member) return null;
    try {
        return channel.permissionsFor(member) || null;
    } catch {
        return null;
    }
}

function memberCanViewChannel(channel, member, isAdmin = false) {
    if (isAdmin) return true;
    return Boolean(getNativePermissions(channel, member)?.has(PermissionFlagsBits.ViewChannel));
}

function memberCanSendToChannel(channel, member, isAdmin = false) {
    if (isAdmin) return true;
    const permissions = getNativePermissions(channel, member);
    return Boolean(
        permissions?.has(PermissionFlagsBits.SendMessages)
        || permissions?.has(PermissionFlagsBits.SendMessagesInThreads)
    );
}

module.exports = {
    memberCanSendToChannel,
    memberCanViewChannel,
};
