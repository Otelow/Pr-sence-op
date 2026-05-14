// MODIFIÉ CHANTIER 6 — 14/05/2026 — helpers réactions Discord isolés
const { sleep } = require('./sleep');

async function safeReact(msg, emoji, retries = 2) {
    let toReact = emoji;
    const match = typeof emoji === 'string' ? emoji.match(/^(\w+):(\d+)$/) : null;
    if (match) toReact = match[2];

    for (let i = 0; i <= retries; i++) {
        try {
            await msg.react(toReact);
            await sleep(500);
            return true;
        } catch (err) {
            console.warn(`⚠️ safeReact échec (${emoji}, tentative ${i + 1}/${retries + 1}):`, err.message);
            if (i < retries) await sleep(1000);
        }
    }
    console.error(`❌ safeReact ABANDONNÉ pour emoji: ${emoji}`);
    return false;
}

async function addPresenceReactions(msg, emojis) {
    await Promise.all(emojis.map((emoji, index) => (
        sleep(index * 250).then(() => safeReact(msg, emoji))
    )));
}

module.exports = {
    safeReact,
    addPresenceReactions,
};
