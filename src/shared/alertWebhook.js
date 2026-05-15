// FINAL POST-STAB G 17/05/2026 — alertes Discord sanitizées sur erreurs critiques
const log = require('./logger');

const ALERT_THROTTLE_MS = 60 * 1000;
let lastAlertTs = 0;

function sanitizeContext(context) {
    return String(context || 'Erreur critique')
        .replace(/[`*_~|<>@]/g, '')
        .slice(0, 160);
}

async function alertDiscordError(context) {
    const url = process.env.ERROR_WEBHOOK_URL;
    if (!url) return;

    const now = Date.now();
    if (now - lastAlertTs < ALERT_THROTTLE_MS) return;
    lastAlertTs = now;

    const safeContext = sanitizeContext(context);
    const content = `🚨 **21BS Alert**\n${safeContext}\nConsulte les logs Railway pour le détail.`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, username: '21BS Alerts' }),
        });
    } catch (e) {
        log.warn({ err: e.message }, 'alertWebhook push échoué');
    }
}

module.exports = { alertDiscordError };
