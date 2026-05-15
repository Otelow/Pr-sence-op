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

function messageHasClipPayload(message) {
    const hasClipLink = extractClipLinks(message.content).length > 0;
    const hasClipAttachment = message.attachments?.some(attachment => isClipAttachment(attachment));
    return hasClipLink || hasClipAttachment;
}

async function maybeRemindClipForum(message) {
    if (!message || message.author?.bot) return;
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
    maybeRemindClipForum,
};
