// RELANCE ABSENCE + CONTRASTE 19/05/2026
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
        startRemindUserAbsence,
        stopRemindUserAbsence,
    } = context;

    const isFirstPresenceOp = op => op === 'op1' || op === 1;

    client.on('messageReactionAdd', async (reaction, user) => {
        if (user.bot) return;

        const msgId = reaction.message.id;
        const map = getReactionMap(msgId);
        if (!map) return;

        const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
        if (!type) return;

        const set = ensureReactionSet(map, user.id);
        set.add(type);

        const op = getPresenceOpForMessageId(msgId);
        emitRealtime('presence:reaction', { op, userId: user.id, type });
        scheduleAbsencePanelRefresh();

        if (isFirstPresenceOp(op)) {
            if (type === 'no') startRemindUserAbsence?.(user.id);
            if (type === 'check' || type === 'retard') stopRemindUserAbsence?.(user.id, 'reaction_removed');
        }
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
            const op = getPresenceOpForMessageId(msgId);
            emitRealtime('presence:reaction', { op, userId: user.id, type: null });
            scheduleAbsencePanelRefresh();
            if (isFirstPresenceOp(op) && type === 'no') stopRemindUserAbsence?.(user.id, 'reaction_removed');
            return;
        }

        set.delete(type);
        if (set.size === 0) map.delete(user.id);

        const op = getPresenceOpForMessageId(msgId);
        emitRealtime('presence:reaction', { op, userId: user.id, type: null });
        scheduleAbsencePanelRefresh();
        if (isFirstPresenceOp(op) && type === 'no') stopRemindUserAbsence?.(user.id, 'reaction_removed');
    });
}

module.exports = { registerPresenceReactionEvents };
