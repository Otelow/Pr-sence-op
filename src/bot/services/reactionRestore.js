// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
// MODIFIE CHANTIER 6 - 14/05/2026 - restauration reactions presence externalisee

function createReactionRestoreService(deps) {
    const {
        CONFIG,
        client,
        emojiToType,
    } = deps;

    async function restoreReactionsFromMessage(messageId, reactionMap) {
        try {
            const channel = client.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
            if (!channel) return false;

            const msg = await channel.messages.fetch(messageId).catch(() => null);
            if (!msg) return false;

            reactionMap.clear();
            for (const [, reaction] of msg.reactions.cache) {
                const users = await reaction.users.fetch();
                for (const [userId, user] of users) {
                    if (user.bot) continue;
                    const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
                    if (type) reactionMap.set(userId, type);
                }
            }
            log.info(`   ↳ ${reactionMap.size} réaction(s) restaurées`);
            return true;
        } catch (e) {
            log.error('❌ Erreur restauration réactions:', e.message);
            return false;
        }
    }

    return {
        restoreReactionsFromMessage,
    };
}

module.exports = {
    createReactionRestoreService,
};
