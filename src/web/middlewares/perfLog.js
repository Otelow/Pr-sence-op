// FINAL POST-STAB A 17/05/2026 ? pino backend
const log = require('../../shared/logger');
// MODIFIÉ CHANTIER 6 — 14/05/2026 — middleware perf log isolé
function perfLog(req, res, next) {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        if (durationMs < 1000) return;
        const level = durationMs >= 5000 ? 'CRITICAL' : 'WARNING';
        const pathOnly = req.originalUrl.split('?')[0];
        const userId = req.session?.user?.id || 'anonymous';
        log.warn(`[PERF ${level}] ${req.method} ${pathOnly} ${res.statusCode} ${Math.round(durationMs)}ms user=${userId}`);
    });
    next();
}

module.exports = { perfLog };
