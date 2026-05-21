// AUDIT HARDENING 21/05/2026 — calcul OP sans réaction testable

function toSet(value) {
    if (value instanceof Set) return value;
    if (value && typeof value.keys === 'function') return new Set(value.keys());
    return new Set();
}

function hasRole(member, roleId) {
    if (!roleId) return false;
    return Boolean(member?.roles?.cache?.has?.(roleId));
}

function collectNoReactionMembers({ role, reactionMap, validAbsences, invalidAbsences, excludedRoleId }) {
    const reacted = toSet(reactionMap);
    const noReact = [];
    const validAbsenceSet = validAbsences instanceof Set ? validAbsences : new Set();
    const invalidAbsenceSet = invalidAbsences instanceof Set ? invalidAbsences : new Set();

    for (const [, member] of role?.members || []) {
        if (member?.user?.bot) continue;
        if (hasRole(member, excludedRoleId)) continue;
        if (reacted.has(member.id)) continue;
        if (validAbsenceSet.has(member.id)) continue;
        if (invalidAbsenceSet.has(member.id)) continue;
        noReact.push(member);
    }

    return { noReact, reacted };
}

module.exports = {
    collectNoReactionMembers,
};
