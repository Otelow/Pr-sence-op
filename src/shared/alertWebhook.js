// QUICK WINS 3 18/05/2026 — erreurs critiques tracées dans audit_log
// FINAL POST-STAB G 17/05/2026 — alertes Discord sanitizées sur erreurs critiques
const log = require('./logger');

const ALERT_THROTTLE_MS = 60 * 1000;
let lastAlertTs = 0;

function sanitizeContext(context) {
    return String(context || 'Erreur critique')
        .replace(/[`*_~|<>@]/g, '')
        .slice(0, 160);
}

function auditError(context, error, meta = {}) {
    try {
        const { audit } = require('./auditLog');
        audit(null, 'error.500', {
            target_type: 'system',
            details: {
                context: String(context || ''),
                message: error?.message || String(error || context || 'Erreur critique'),
                http_path: meta.path || null,
            },
        });
    } catch (e) {
        log.warn({ err: e.message }, 'audit erreur critique échoué');
    }
}

async function alertDiscordError(context, error = null, meta = {}) {
    auditError(context, error, meta);

    const url = process.env.ERROR_WEBHOOK_URL;
    if (!url) return;

    const now = Date.now();
    if (now - lastAlertTs < ALERT_THROTTLE_MS) return;
    lastAlertTs = now;

    const safeContext = sanitizeContext(context);
    const message = error?.message ? `\n${sanitizeContext(error.message)}` : '';
    const content = `🚨 **21BS Alert**\n${safeContext}${message}\nConsulte les logs Railway pour le détail.`;

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
