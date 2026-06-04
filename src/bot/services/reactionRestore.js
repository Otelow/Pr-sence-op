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

    async function fetchAllReactionUsers(reaction) {
        const usersById = new Map();
        let after;

        while (true) {
            const users = await reaction.users.fetch({ limit: 100, after });
            for (const [userId, user] of users) {
                usersById.set(userId, user);
            }
            if (users.size < 100) break;
            after = users.lastKey();
            if (!after) break;
        }

        return usersById;
    }

    async function restoreReactionsFromMessage(messageId, reactionMap) {
        const before = new Map();
        for (const [userId, set] of reactionMap) {
            before.set(userId, new Set(set));
        }

        try {
            const channel = client.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
            if (!channel) return false;

            const msg = await channel.messages.fetch({ message: messageId, cache: false, force: true }).catch(() => null);
            if (!msg) {
                log.warn(`⚠️ Message ${messageId} introuvable, conservation des réactions depuis disk (${before.size} users)`);
                return false;
            }

            reactionMap.clear();
            const counts = {};
            for (const [, reaction] of msg.reactions.cache) {
                const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
                if (!type) continue;

                const users = await fetchAllReactionUsers(reaction);
                let humanCount = 0;
                for (const [userId, user] of users) {
                    if (user.bot) continue;
                    humanCount += 1;
                    ensureReactionSet(reactionMap, userId).add(type);
                }
                counts[type] = (counts[type] || 0) + humanCount;
            }
            log.info({ messageId, counts, totalUsers: reactionMap.size }, 'Réactions présence restaurées depuis Discord');
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
