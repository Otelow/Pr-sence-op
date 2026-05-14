// MODIFIÉ CHANTIER 6 — 14/05/2026 — events réactions présence isolés
const { emitRealtime } = require('../../shared/realtime');

function registerPresenceReactionEvents(client, context) {
    const {
        getReactionMap,
        emojiToType,
        getPresenceOpForMessageId,
        scheduleAbsencePanelRefresh,
    } = context;

    client.on('messageReactionAdd', async (reaction, user) => {
        if (user.bot) return;

        const msgId = reaction.message.id;
        const map = getReactionMap(msgId);
        if (!map) return;

        const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
        if (type) {
            map.set(user.id, type);
            emitRealtime('presence:reaction', { op: getPresenceOpForMessageId(msgId), userId: user.id, type });
            scheduleAbsencePanelRefresh();
        }
    });

    client.on('messageReactionRemove', async (reaction, user) => {
        if (user.bot) return;

        const msgId = reaction.message.id;
        const map = getReactionMap(msgId);
        if (!map) return;

        const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
        if (type && map.get(user.id) === type) {
            map.delete(user.id);
            emitRealtime('presence:reaction', { op: getPresenceOpForMessageId(msgId), userId: user.id, type: null });
            scheduleAbsencePanelRefresh();
        }
    });
}

module.exports = { registerPresenceReactionEvents };
