// FIX PRÉSENCE 18/05/2026 — 3 bugs classification corrigés

function ensureReactionSet(reactionMap, userId) {
    let set = reactionMap.get(userId);
    if (!(set instanceof Set)) {
        set = set ? new Set([set]) : new Set();
        reactionMap.set(userId, set);
    }
    return set;
}

function pickReactionPriority(set) {
    if (!set) return null;
    const reactions = set instanceof Set ? set : new Set([set]);
    if (reactions.size === 0) return null;
    if (reactions.has('check')) return 'check';
    if (reactions.has('retard')) return 'retard';
    if (reactions.has('no')) return 'no';
    return null;
}

module.exports = {
    ensureReactionSet,
    pickReactionPriority,
};
