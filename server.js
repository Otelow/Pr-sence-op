// QUICK WINS 3 18/05/2026 — erreurs 500 tracées pour monitoring
// EXPORT DB TEMPORAIRE 28/05/2026 — téléchargement protégé Railway
// EXPORT IMAGES CRAFT TEMPORAIRE 28/05/2026 — ZIP protégé Railway
// ROLES MAP VIEW 18/05/2026 — accès lecture seule carte (sans labs armes)
// FINAL POST-STAB A 17/05/2026 ? pino backend
const log = require('./src/shared/logger');
// FINAL POST-STAB G 17/05/2026 — middleware alerte erreurs serveur
const { alertDiscordError } = require('./src/shared/alertWebhook');
// FINAL D3 16/05/2026 — route monitoring admin détaillée
// STABILISATION FINALE 15/05/2026 - charset statics et monitoring admin leger
// STABILISATION 15/05/2026 — corrections runtime post-audit
// ==========================================
// Serveur web — Dashboard 21 Block Savage
// MODIFIÉ CHANTIER 2 — 14/05/2026 — sessions persistantes SQLite Railway
// MODIFIÉ CHANTIER 3 — 14/05/2026 — helmet, rate-limit et rafraîchissement rôles
// MODIFIÉ CHANTIER 4 — 14/05/2026 — permissions partagées et config publique
// MODIFIÉ CHANTIER 10 — 14/05/2026 — healthcheck Railway
// MODIFIÉ CHANTIER 12 — 14/05/2026 — Socket.IO dashboard avec fallback polling
// MODIFIÉ CHANTIER 6 — 14/05/2026 — middlewares web externalisés
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes health/pages/config/admin clips isolées
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes carte isolées
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes référentiels Discord isolées
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes salons Discord isolées
// MODIFIE HOTFIX UI — 14/05/2026 — autorise les handlers inline du dashboard existant
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes présence/statistiques isolées
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes actions dashboard isolées
// ==========================================

const express = require('express');
const http = require('http');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const axios = require('axios');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { PermissionFlagsBits } = require('discord.js');
const config = require('./src/shared/config');
const { createBetterSqliteSessionStore } = require('./src/web/services/sessionStore');
const { memberCanSendToChannel, memberCanViewChannel } = require('./src/web/services/discordPermissions');
const {
    requireAuth,
    requireAdmin,
    requireFullSiteAccess,
    requireMapViewAccess,
    isUserAdmin,
    hasFullSiteAccess,
    hasLimitedCraftAccess,
    canAccessCrafts,
    canAccessMyWeapons,
    canEditMapUser,
} = require('./src/web/middlewares/auth');
const { perfLog } = require('./src/web/middlewares/perfLog');
const { initDB, registerCraftEndpoints } = require('./crafts');
const { emitRealtime } = require('./src/shared/realtime');
const { attachRealtimeSocket } = require('./src/web/realtimeSocket');
const { registerHealthRoutes } = require('./src/web/routes/health');
const { registerAuthRoutes } = require('./src/web/routes/auth');
const { registerPageRoutes } = require('./src/web/routes/pages');
const { registerConfigRoutes } = require('./src/web/routes/config');
const { registerAdminClipRoutes } = require('./src/web/routes/adminClips');
const { registerMapRoutes } = require('./src/web/routes/map');
const { registerDirectoryRoutes } = require('./src/web/routes/directory');
const { registerChannelRoutes } = require('./src/web/routes/channels');
const { registerPresenceStatsRoutes } = require('./src/web/routes/presenceStats');
const { registerDashboardActionRoutes } = require('./src/web/routes/dashboardActions');
const { registerDashboardOverviewRoutes } = require('./src/web/routes/dashboardOverview');
const { registerHealthDetailedRoutes } = require('./src/web/routes/healthDetailed');

const PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ROLE_SESSION_CACHE_TTL_MS = 120 * 1000;

let botClient;
let botState;

function startServer(client, getState) {
    botClient = client;
    botState = getState;

    const app = express();
    const httpServer = http.createServer(app);
    fs.mkdirSync(config.paths.data, { recursive: true });
    const sessionStore = createBetterSqliteSessionStore({
        dir: config.paths.data,
        db: 'sessions.db',
        table: 'sessions',
        ttlMs: config.web.sessionMaxAgeMs,
    });
    const roleSessionCache = new Map();
    const authLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 10,
        standardHeaders: true,
        legacyHeaders: false,
    });
    const commandLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 30,
        standardHeaders: true,
        legacyHeaders: false,
    });
    const craftsWriteLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
        skip: req => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method),
    });
    const sessionMiddleware = session({
        store: sessionStore,
        secret: SESSION_SECRET || config.web.sessionSecret,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            maxAge: config.web.sessionMaxAgeMs,
            httpOnly: true,
            sameSite: 'lax',
            secure: config.isProduction || config.isRailway,
        },
    });
    const realtimeServer = attachRealtimeSocket(httpServer, sessionMiddleware);

    app.set('trust proxy', 1);
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                // TODO audit-hardening: unsafe-inline reste temporaire pour les anciens handlers inline du dashboard/admin.
                // Les zones craft/org/admin les plus risquées sont migrées progressivement vers data-* + addEventListener.
                scriptSrc: ["'self'", "'unsafe-inline'"],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                styleSrcAttr: ["'unsafe-inline'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                frameAncestors: ["'none'"],
                formAction: ["'self'", 'https://discord.com'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
                imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com', 'https://media.discordapp.net'],
                mediaSrc: ["'self'", 'https://cdn.discordapp.com', 'https://media.discordapp.net'],
                connectSrc: ["'self'", 'ws:', 'wss:'],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
            },
        },
    }));
    app.use(compression());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public'), {
        maxAge: config.isProduction || config.isRailway ? '1h' : 0,
        setHeaders: (res, filePath) => {
            if (/\.html$/i.test(filePath)) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache');
            } else if (/\.js$/i.test(filePath)) {
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache');
            } else if (/\.css$/i.test(filePath)) {
                res.setHeader('Content-Type', 'text/css; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache');
            } else if (/\.(png|jpe?g|webp|gif|svg|ico)$/i.test(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=604800');
            }
        },
    }));
    app.use(sessionMiddleware);
    app.use(perfLog);
    app.use((req, res, next) => {
        res.on('finish', () => {
            if (res.statusCode >= 500) {
                alertDiscordError(`Serveur ${res.statusCode} ${req.method} ${req.path}`);
            }
        });
        next();
    });

    registerHealthRoutes(app, () => botClient);

    // ==========================================
    // OAuth2 Discord
    // ==========================================
    registerAuthRoutes(app, {
        authLimiter,
        axios,
        DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET,
        DISCORD_REDIRECT_URI,
        getBotClient: () => botClient,
        getBotState: () => botState(),
    });

    function getGuild() {
        const state = botState?.();
        const guildId = state?.CONFIG?.GUILD_ID;
        return guildId ? botClient?.guilds?.cache?.get(guildId) : null;
    }

    function requireBotReady(req, res, next) {
        if (!botClient?.isReady?.()) {
            return res.status(503).json({
                error: 'Bot Discord indisponible, réessaie dans quelques secondes',
            });
        }
        next();
    }

    async function refreshSessionRoles(req, res, next) {
        const user = req.session?.user;
        if (!user?.id) return next();

        const cached = roleSessionCache.get(user.id);
        if (cached && Date.now() - cached.fetchedAt < ROLE_SESSION_CACHE_TTL_MS) {
            user.roles = cached.roles;
            return next();
        }

        const guild = getGuild();
        if (!guild?.members?.fetch) return next();

        try {
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (!member) return next();

            const roles = [...member.roles.cache.keys()];
            roleSessionCache.set(user.id, { roles, fetchedAt: Date.now() });
            user.roles = roles;
            user.username = member.nickname || member.user.username || user.username;
            user.avatar = member.user.avatar
                ? `https://cdn.discordapp.com/avatars/${member.id}/${member.user.avatar}.png?size=128`
                : user.avatar;
        } catch (e) {
            log.warn(`⚠️ Refresh rôles session impossible pour ${user.id}:`, e.message);
        }

        next();
    }

    function canRoleViewChannel(channel, role) {
        if (!channel?.permissionsFor || !role) return false;
        return channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel) ?? false;
    }

    function userCanViewChannel(channel, user) {
        if (isUserAdmin(user)) return true;
        const guild = getGuild();
        if (!guild || !channel?.permissionsFor) return false;
        const member = user?.id ? guild.members.cache.get(user.id) : null;
        if (member) return memberCanViewChannel(channel, member);
        const roleIds = user?.roles || [];
        const everyoneCanView = guild.roles?.everyone
            ? canRoleViewChannel(channel, guild.roles.everyone)
            : false;
        const roleCanView = roleIds.some(roleId => canRoleViewChannel(channel, guild.roles.cache.get(roleId)));
        return Boolean(everyoneCanView || roleCanView);
    }

    function userCanSendToChannel(channel, user) {
        if (!userCanViewChannel(channel, user)) return false;
        if (isUserAdmin(user)) return true;
        const guild = getGuild();
        if (!guild || !channel?.permissionsFor) return false;
        const member = user?.id ? guild.members.cache.get(user.id) : null;
        if (member) return memberCanSendToChannel(channel, member);
        return (user?.roles || []).some(roleId => {
            const role = guild.roles.cache.get(roleId);
            const permissions = role ? channel.permissionsFor(role) : null;
            return Boolean(
                permissions?.has(PermissionFlagsBits.SendMessages)
                || permissions?.has(PermissionFlagsBits.SendMessagesInThreads)
            );
        });
    }

    async function fetchDiscordChannel(channelId) {
        return botClient?.channels?.cache?.get(channelId)
            || await botClient?.channels?.fetch(channelId).catch(() => null);
    }

    app.use(refreshSessionRoles);

    registerHealthDetailedRoutes(app, {
        requireAdmin,
        getBotClient: () => botClient,
        getRealtimeServer: () => realtimeServer,
    });

    // Initialiser la DB crafts
    try {
        initDB();
    } catch (e) {
        log.error('Erreur init DB crafts:', e.message);
        if (config.isProduction || config.isRailway) process.exit(1);
    }

    registerPageRoutes(app, {
        publicDir: path.join(__dirname, 'public'),
        privateDir: path.join(__dirname, 'private'),
        isUserAdmin,
    });

    // Enregistrer les endpoints crafts
    app.use('/api/crafts', craftsWriteLimiter);
    try {
        registerCraftEndpoints(app, requireAuth, requireAdmin, botClient, botState);
        log.info('🔫 Endpoints crafts enregistrés');
    } catch (e) {
        log.error('❌ Erreur endpoints crafts:', e.message);
    }

    registerAdminClipRoutes(app, { requireAdmin, getBotClient: () => botClient });

    // ==========================================
    // API
    // ==========================================
    registerConfigRoutes(app, {
        requireAuth,
        isUserAdmin,
        hasFullSiteAccess,
        hasLimitedCraftAccess,
        canAccessCrafts,
        canAccessMyWeapons,
        canEditMapUser,
    });

    app.use([
        '/api/presence',
        '/api/weekly',
        '/api/command',
        '/api/channels',
        '/api/channel',
        '/api/sanctions',
        '/api/stats',
        '/api/members',
        '/api/roles',
        '/api/emojis',
    ], requireBotReady);

    // ==========================================
    // API - Presence et statistiques
    // ==========================================
    registerPresenceStatsRoutes(app, {
        requireAuth,
        requireFullSiteAccess,
        getBotClient: () => botClient,
        getBotState: () => botState(),
        emitRealtime,
    });

    registerDashboardOverviewRoutes(app, {
        requireAuth,
        requireFullSiteAccess,
        getBotClient: () => botClient,
        getBotState: () => botState(),
    });

    // ==========================================
    // API - Actions dashboard et sanctions
    // ==========================================
    registerDashboardActionRoutes(app, {
        commandLimiter,
        requireAuth,
        requireFullSiteAccess,
        getBotClient: () => botClient,
        getBotState: () => botState(),
        emitRealtime,
    });

    // ==========================================
    // API - Salons Discord
    // ==========================================
    registerChannelRoutes(app, {
        requireAuth,
        requireFullSiteAccess,
        getBotClient: () => botClient,
        getBotState: () => botState(),
        fetchDiscordChannel,
        userCanViewChannel,
        userCanSendToChannel,
        canRoleViewChannel,
        isUserAdmin,
        hasFullSiteAccess,
    });

    registerDirectoryRoutes(app, {
        requireAuth,
        requireFullSiteAccess,
        getBotClient: () => botClient,
        getBotState: () => botState(),
    });

    // ==========================================
    // API - Carte interactive (points)
    // ==========================================
    registerMapRoutes(app, {
        requireAuth,
        requireMapViewAccess,
        isUserAdmin,
        canEditMapUser,
    });

    app.get('/admin/export-db', (req, res) => {
        const token = process.env.EXPORT_TOKEN;
        if (!token || req.query.token !== token) {
            return res.status(403).send('Forbidden');
        }

        const allowed = [
            'crafts.db',
            'crafts.db-wal',
            'crafts.db-shm',
        ];
        const file = String(req.query.file || 'crafts.db');
        if (!allowed.includes(file)) {
            return res.status(400).send('Invalid file');
        }

        return res.download(path.join('/data', file), file);
    });

    app.get('/admin/list-data', (req, res) => {
        const token = process.env.EXPORT_TOKEN;
        if (!token || req.query.token !== token) {
            return res.status(403).send('Forbidden');
        }

        const root = '/data';
        const files = [];

        function walk(dir) {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                    continue;
                }
                if (!entry.isFile()) continue;
                const stat = fs.statSync(fullPath);
                files.push({
                    path: fullPath,
                    size: stat.size,
                    modified_at: stat.mtime.toISOString(),
                });
            }
        }

        try {
            walk(root);
            return res.json({ root, files });
        } catch (error) {
            log.warn({ err: error.message }, 'export list-data échoué');
            return res.status(500).json({ error: 'Impossible de lister /data' });
        }
    });

    app.get('/admin/export-crafts-images', (req, res) => {
        const token = process.env.EXPORT_TOKEN;
        if (!token || req.query.token !== token) {
            return res.status(403).send('Forbidden');
        }

        const craftsDir = '/data/crafts';
        if (!fs.existsSync(craftsDir)) {
            return res.status(404).send('Crafts images folder not found');
        }

        res.attachment('crafts-images.zip');
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', error => {
            log.warn({ err: error.message }, 'export crafts images zip échoué');
            if (!res.headersSent) return res.status(500).send('ZIP export failed');
            return res.destroy(error);
        });

        archive.pipe(res);
        archive.directory(craftsDir, false);
        return archive.finalize();
    });

    app.use((err, req, res, next) => {
        log.error({ err: err?.message, path: req.path }, 'erreur serveur 500');
        alertDiscordError(`Serveur 500 ${req.method} ${req.path}`, err, { path: req.path });
        if (res.headersSent) return next(err);
        return res.status(500).json({ error: 'Erreur interne' });
    });

    httpServer.listen(PORT, () => {
        log.info(`🌐 Dashboard web démarré sur le port ${PORT}`);
    });
}

module.exports = { startServer };
