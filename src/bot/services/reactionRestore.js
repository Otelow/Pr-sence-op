// PRÉSENCE RÉSILIENTE + DÉTAILS 20/05/2026
// FIX PRÉSENCE 18/05/2026 — 3 bugs classification corrigés
// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
const { ensureReactionSet } = require('../../shared/presenceReactions');
// MODIFIE CHANTIER 6 - 14/05/2026 - restauration reactions presence externalisee

function createReactionRestoreService(deps) {
    const {
        CONFIG,
        client,
        emojiToType,
    } = deps;

    async function restoreReactionsFromMessage(messageId, reactionMap) {
        const before = new Map();
        for (const [userId, set] of reactionMap) {
            before.set(userId, new Set(set));
        }

        try {
            const channel = client.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
            if (!channel) return false;

            const msg = await channel.messages.fetch(messageId).catch(() => null);
            if (!msg) {
                log.warn(`⚠️ Message ${messageId} introuvable, conservation des réactions depuis disk (${before.size} users)`);
                return false;
            }

            reactionMap.clear();
            for (const [, reaction] of msg.reactions.cache) {
                const users = await reaction.users.fetch();
                for (const [userId, user] of users) {
                    if (user.bot) continue;
                    const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
                    if (type) ensureReactionSet(reactionMap, userId).add(type);
                }
            }
            log.info(`   ↳ ${reactionMap.size} réaction(s) restaurées depuis Discord`);
            return true;
        } catch (e) {
            log.error('❌ Erreur restauration réactions:', e.message);
            reactionMap.clear();
            for (const [userId, set] of before) {
                reactionMap.set(userId, set);
            }
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
