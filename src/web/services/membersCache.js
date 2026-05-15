// FINAL POST-STAB F 17/05/2026 — cache serveur des membres Discord
const log = require('../../shared/logger');

const CACHE_TTL_MS = 60 * 1000;
let cache = null;
let fetchedAt = 0;
let inflight = null;

async function getCachedMembers(guild) {
    if (!guild?.members?.fetch) return guild?.members?.cache || new Map();

    const now = Date.now();
    if (cache && (now - fetchedAt) < CACHE_TTL_MS) return cache;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            await guild.members.fetch();
            cache = guild.members.cache;
            fetchedAt = Date.now();
            log.debug({ size: cache.size }, 'members cache rafraîchi');
            return cache;
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

function invalidateMembersCache() {
    cache = null;
    fetchedAt = 0;
}

module.exports = { getCachedMembers, invalidateMembersCache };
