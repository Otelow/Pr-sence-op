// CLIPS BYPASS 22/05/2026 — salon whitelist + user exempt
// WHITELIST CATEGORIES 18/05/2026 — autoriser liens/vidéos
// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
// MODIFIÉ CHANTIER 6 — 14/05/2026 — events clips forum isolés
const config = require('../../shared/config');
const { processClipMessage, extractClipLinks, isClipAttachment } = require('../../shared/clipBackup');

const clipReminderCooldown = new Map();

function isClipForumMessage(message) {
    const forumId = config.clips.forumChannelId;
    return String(message.channelId) === String(forumId) || String(message.channel?.parentId || '') === String(forumId);
}

function isInAllowedCategory(message) {
    const allowedCats = config.clips.allowedCategoryIds || [];
    if (allowedCats.length === 0) return false;
    const parentId = String(message.channel?.parentId || '');
    if (!parentId) return false;
    return allowedCats.includes(parentId);
}

function isInAllowedChannel(message) {
    const allowed = config.clips.allowedChannelIds || [];
    if (allowed.length === 0) return false;
    return allowed.includes(String(message.channelId));
}

function isBypassUser(message) {
    const bypass = config.clips.bypassUserIds || [];
    return bypass.includes(String(message.author?.id || ''));
}

function messageHasClipPayload(message) {
    const hasClipLink = extractClipLinks(message.content).length > 0;
    const hasClipAttachment = message.attachments?.some(attachment => isClipAttachment(attachment));
    return hasClipLink || hasClipAttachment;
}

async function maybeRemindClipForum(message) {
    if (!message || message.author?.bot) return;
    if (isBypassUser(message)) return;
    if (isInAllowedChannel(message)) return;
    if (isInAllowedCategory(message)) return;
    if (isClipForumMessage(message)) return;
    if (!messageHasClipPayload(message)) return;

    const now = Date.now();
    const cooldownKey = String(message.author.id);
    const last = clipReminderCooldown.get(cooldownKey) || 0;
    const shouldReply = now - last >= 60_000;

    if (shouldReply) {
        clipReminderCooldown.set(cooldownKey, now);

        try {
            await message.reply({
                content: `Merci pour ton clip ! Pour qu'on puisse le retrouver et le sauvegarder correctement, poste-le dans le salon <#${config.clips.forumChannelId}> s'il te plait 🙏`,
                allowedMentions: { repliedUser: true, parse: [] },
            });
        } catch (e) {
            log.error(`[clips] rappel salon clips echoue: ${e.message}`);
        }
    }

    try {
        if (!message.deletable) {
            log.warn('[clips] suppression message clip hors forum impossible: permission Manage Messages manquante ou message non supprimable');
            return;
        }

        await message.delete();
    } catch (e) {
        log.warn(`[clips] suppression message clip hors forum impossible: ${e.message}`);
    }
}

function registerClipEvents(client) {
    client.on('messageCreate', async message => {
        try {
            if (isClipForumMessage(message)) {
                await processClipMessage(message);
            } else {
                await maybeRemindClipForum(message);
            }
        } catch (e) {
            log.error(`[clips] traitement temps reel echoue: ${e.message}`);
        }
    });
}

module.exports = {
    registerClipEvents,
    isClipForumMessage,
    isInAllowedCategory,
    isInAllowedChannel,
    isBypassUser,
    maybeRemindClipForum,
};
