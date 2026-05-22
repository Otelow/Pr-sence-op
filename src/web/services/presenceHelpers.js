// FIX DÉCROCHÉS + CARDS 22/05/2026

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value instanceof Set) return [...value];
    if (value instanceof Map) return [...value.values()];
    return [];
}

function countStatus(value) {
    if (Array.isArray(value)) return value.length;
    if (value instanceof Set || value instanceof Map) return value.size;
    const count = Number(value || 0);
    return Number.isFinite(count) ? count : 0;
}

function getUserId(user) {
    if (user && typeof user === 'object') return user.user_id || user.id || null;
    return user || null;
}

function wasOpLaunched(opCounts = {}) {
    const present = countStatus(opCounts.present);
    const late = countStatus(opCounts.late);
    const absentReact = countStatus(opCounts.absentReact);
    return (present + late + absentReact) > 0;
}

function computeDecroches(op1 = {}, op2 = {}) {
    if (!wasOpLaunched(op2)) return [];

    const presents1 = new Set(
        [...asArray(op1.present), ...asArray(op1.late)]
            .map(getUserId)
            .filter(Boolean)
    );
    const decroches2 = new Map();

    for (const user of [...asArray(op2.noReaction), ...asArray(op2.absentReact)]) {
        const userId = getUserId(user);
        if (userId) decroches2.set(userId, user);
    }

    return [...presents1]
        .filter(userId => decroches2.has(userId))
        .map(userId => decroches2.get(userId));
}

module.exports = {
    asArray,
    computeDecroches,
    wasOpLaunched,
};
