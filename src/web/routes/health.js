// MODIFIÉ CHANTIER 6 — 14/05/2026 — route healthcheck isolée
// MODIFIE HOTFIX RAILWAY - 14/05/2026 - healthcheck web independant du ready Discord
function registerHealthRoutes(app, getBotClient) {
    app.get('/healthz', (req, res) => {
        const botClient = getBotClient();
        const discordReady = botClient?.isReady?.() ?? false;
        res.status(200).json({
            ready: true,
            discordReady,
            uptime: Math.round(process.uptime()),
            memMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            ts: Date.now(),
        });
    });
}

module.exports = { registerHealthRoutes };
