// MODIFIÉ CHANTIER 6 — 14/05/2026 — route healthcheck isolée
function registerHealthRoutes(app, getBotClient) {
    app.get('/healthz', (req, res) => {
        const botClient = getBotClient();
        const ready = botClient?.isReady?.() ?? false;
        res.status(ready ? 200 : 503).json({
            ready,
            uptime: Math.round(process.uptime()),
            memMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            ts: Date.now(),
        });
    });
}

module.exports = { registerHealthRoutes };
