// MODIFIÉ CHANTIER 12 — 14/05/2026 — bus temps réel dashboard
const { EventEmitter } = require('events');

const realtimeEvents = new EventEmitter();
realtimeEvents.setMaxListeners(50);

function emitRealtime(type, payload = {}) {
    if (!type) return;
    realtimeEvents.emit('event', {
        type,
        payload: {
            ...payload,
            ts: Date.now(),
        },
    });
}

module.exports = {
    realtimeEvents,
    emitRealtime,
};
