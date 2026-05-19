// FIX PRÉSENCE 18/05/2026 — 3 bugs classification corrigés
// MODIFIÉ CHANTIER 6 — 14/05/2026 — events réactions présence isolés
const { emitRealtime } = require('../../shared/realtime');
const { ensureReactionSet } = require('../../shared/presenceReactions');

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
        if (!type) return;

        const set = ensureReactionSet(map, user.id);
        set.add(type);

        emitRealtime('presence:reaction', { op: getPresenceOpForMessageId(msgId), userId: user.id, type });
        scheduleAbsencePanelRefresh();
    });

    client.on('messageReactionRemove', async (reaction, user) => {
        if (user.bot) return;

        const msgId = reaction.message.id;
        const map = getReactionMap(msgId);
        if (!map) return;

        const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
        if (!type) return;

        const set = map.get(user.id);
        if (!(set instanceof Set)) {
            if (set !== type) return;
            map.delete(user.id);
            emitRealtime('presence:reaction', { op: getPresenceOpForMessageId(msgId), userId: user.id, type: null });
            scheduleAbsencePanelRefresh();
            return;
        }

        set.delete(type);
        if (set.size === 0) map.delete(user.id);

        emitRealtime('presence:reaction', { op: getPresenceOpForMessageId(msgId), userId: user.id, type: null });
        scheduleAbsencePanelRefresh();
    });
}

module.exports = { registerPresenceReactionEvents };
