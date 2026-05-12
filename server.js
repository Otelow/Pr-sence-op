// ==========================================
// Serveur web — Dashboard 21 Block Savage
// ==========================================

const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const config = require('./src/shared/config');
const { initDB, registerCraftEndpoints } = require('./crafts');
const { backfillClipForum, getBackfillStatus, getRecentClipBackups } = require('./src/shared/clipBackup');

const PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET;

let botClient;
let botState;

function startServer(client, getState) {
    botClient = client;
    botState = getState;

    const app = express();

    app.set('trust proxy', 1);
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public'), {
        maxAge: config.isProduction || config.isRailway ? '1h' : 0,
        setHeaders: (res, filePath) => {
            if (/\.(png|jpe?g|webp|gif|svg|ico)$/i.test(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=604800');
            }
        },
    }));
    app.use(session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            maxAge: config.web.sessionMaxAgeMs,
            httpOnly: true,
            sameSite: 'lax',
            secure: config.isProduction || config.isRailway,
        },
    }));
    app.use((req, res, next) => {
        const startedAt = process.hrtime.bigint();
        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            if (durationMs < 1000) return;
            const level = durationMs >= 5000 ? 'CRITICAL' : 'WARNING';
            const pathOnly = req.originalUrl.split('?')[0];
            const userId = req.session?.user?.id || 'anonymous';
            console.warn(`[PERF ${level}] ${req.method} ${pathOnly} ${res.statusCode} ${Math.round(durationMs)}ms user=${userId}`);
        });
        next();
    });

    // ==========================================
    // OAuth2 Discord
    // ==========================================
    app.get('/auth/login', (req, res) => {
        const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
        res.redirect(url);
    });

    app.get('/auth/callback', async (req, res) => {
        const code = req.query.code;
        if (!code) return res.redirect('/');

        const errorPage = (msg, opts = {}) => {
            const title = opts.title || 'ACCÈS REFUSÉ';
            const subtitle = opts.subtitle || 'PASSERELLE BLOQUÉE';
            const image = opts.image || null;
            return `
<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Accès refusé — 21 Block Savage</title>
<link rel="stylesheet" href="/style.css">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
body.login-body { overflow: hidden; }
.darknet-denial {
    width: min(92vw, 760px);
    min-height: 620px;
    margin: 7vh auto;
    padding: 34px;
    border: 1px solid rgba(255, 138, 0, .32);
    background:
        radial-gradient(circle at 50% 0%, rgba(255, 138, 0, .22), transparent 42%),
        linear-gradient(180deg, rgba(19, 15, 10, .96), rgba(3, 3, 3, .98));
    box-shadow: 0 0 80px rgba(255, 138, 0, .16), inset 0 1px 0 rgba(255,255,255,.08);
}
.denial-scan {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: 1px solid rgba(255, 138, 0, .28);
    color: #ffb84d;
    background: rgba(255, 138, 0, .08);
    font: 700 12px/1 "JetBrains Mono", monospace;
    letter-spacing: .18em;
}
.denial-art {
    width: min(340px, 66vw);
    aspect-ratio: 1;
    display: block;
    margin: 26px auto 22px;
    object-fit: cover;
    border-radius: 28px;
    border: 1px solid rgba(255, 184, 77, .25);
    box-shadow: 0 22px 70px rgba(255, 138, 0, .22);
}
.denial-title {
    position: relative;
    margin: 0;
    color: #fff3d6;
    font-family: "Bebas Neue", sans-serif;
    font-size: clamp(54px, 10vw, 96px);
    line-height: .9;
    text-align: center;
    letter-spacing: 0;
    text-shadow: 0 0 28px rgba(255, 138, 0, .42);
    animation: deniedShake .22s infinite steps(2, end);
}
.denial-subtitle {
    margin: 12px 0 0;
    color: #ff8a00;
    font: 700 13px/1.5 "JetBrains Mono", monospace;
    text-align: center;
    letter-spacing: .2em;
}
.denial-message {
    margin: 28px auto 0;
    max-width: 540px;
    padding: 20px 22px;
    border-left: 4px solid #ff8a00;
    color: #f8f0df;
    background: rgba(0, 0, 0, .62);
    font: 500 18px/1.65 "JetBrains Mono", monospace;
}
.btn-back.denial-back {
    display: flex;
    width: fit-content;
    margin: 28px auto 0;
}
@keyframes deniedShake {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(2px, -1px); }
}
</style>
</head>
<body class="login-body">
<div class="grain"></div>
<div class="darknet-denial">
    <div class="denial-scan">ACCÈS BLOQUÉ</div>
    ${image ? `<img class="denial-art" src="${image}" alt="">` : '<div class="error-icon">⚠</div>'}
    <h1 class="denial-title">${title}</h1>
    <p class="denial-subtitle">${subtitle}</p>
    <p class="denial-message">${msg}</p>
    <a href="/" class="btn-back denial-back">← Retour</a>
    </div>
</body></html>`;
        };

        try {
            const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
                new URLSearchParams({
                    client_id: DISCORD_CLIENT_ID,
                    client_secret: DISCORD_CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: DISCORD_REDIRECT_URI,
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const userRes = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
            });

            const user = userRes.data;
            const state = botState();
            const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
            if (!guild) return res.send(errorPage('Bot non connecté au serveur Discord'));

            const member = await guild.members.fetch(user.id).catch(() => null);
            if (!member) return res.send(errorPage('Tu n\'es pas membre du serveur Discord 21 Block Savage'));

            const blackMarketRole = state.CONFIG.ROLES.VIP_ROLE || '1489336767097208922';
            if (member.roles.cache.has(blackMarketRole)) {
                return res.send(errorPage(
                    'Le BlackMarket n\'a pas les autorisations d\'accès sur le Darknet des 21BS.',
                    {
                        title: 'BLACKMARKET',
                        subtitle: 'ACCÈS DARKNET BLOQUÉ',
                        image: '/blackmarket-denied.png',
                    }
                ));
            }

            req.session.user = {
                id: user.id,
                username: member.nickname || user.username,
                avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
                roles: [...member.roles.cache.keys()],
            };

            res.redirect('/dashboard#presence');
        } catch (e) {
            console.error('❌ OAuth erreur:', e.message);
            res.send(errorPage('Erreur de connexion. Réessaie.'));
        }
    });

    app.get('/auth/logout', (req, res) => {
        req.session.destroy(() => res.redirect('/'));
    });

    // ==========================================
    // Middleware d'auth
    // ==========================================
    const ADMIN_USER_ID = '952986899667103804';
    const ADMIN_ROLE_ID = '1485279148246175764';
    const FULL_ACCESS_ROLES = ['1485279148246175764', '1486744891848654988', '1485279534650494976'];

    function requireAuth(req, res, next) {
        if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
        next();
    }

    function isUserAdmin(user) {
        if (!user) return false;
        if (user.id === ADMIN_USER_ID) return true;
        if (user.roles && FULL_ACCESS_ROLES.some(roleId => user.roles.includes(roleId))) return true;
        return false;
    }

    function hasFullSiteAccess(user) {
        if (!user) return false;
        if (user.id === ADMIN_USER_ID) return true;
        return FULL_ACCESS_ROLES.some(roleId => (user.roles || []).includes(roleId));
    }

    function requireFullSiteAccess(req, res, next) {
        if (!hasFullSiteAccess(req.session.user)) {
            return res.status(403).json({ error: 'Accès confidentiel réservé aux hauts gradés' });
        }
        next();
    }

    function requireAdmin(req, res, next) {
        if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
        if (!isUserAdmin(req.session.user)) return res.status(403).json({ error: 'Accès admin requis' });
        // Marquer pour usage downstream
        req.session.user.isAdmin = true;
        next();
    }

    function getGuild() {
        const state = botState?.();
        const guildId = state?.CONFIG?.GUILD_ID;
        return guildId ? botClient?.guilds?.cache?.get(guildId) : null;
    }

    function canRoleViewChannel(channel, role) {
        if (!channel?.permissionsFor || !role) return false;
        return channel.permissionsFor(role)?.has('ViewChannel') ?? false;
    }

    function userCanViewChannel(channel, user) {
        if (isUserAdmin(user)) return true;
        const guild = getGuild();
        if (!guild || !channel?.permissionsFor) return false;
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
        return (user?.roles || []).some(roleId => {
            const role = guild.roles.cache.get(roleId);
            const permissions = role ? channel.permissionsFor(role) : null;
            return Boolean(permissions?.has('SendMessages') || permissions?.has('SendMessagesInThreads'));
        });
    }

    async function fetchDiscordChannel(channelId) {
        return botClient?.channels?.cache?.get(channelId)
            || await botClient?.channels?.fetch(channelId).catch(() => null);
    }

    // Initialiser la DB crafts
    try {
        initDB();
    } catch (e) {
        console.error('Erreur init DB crafts:', e.message);
        if (config.isProduction || config.isRailway) process.exit(1);
    }

    // ==========================================
    // Routes pages
    // ==========================================
    app.get('/', (req, res) => {
        if (req.session.user) return res.redirect('/dashboard#presence');
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.get('/dashboard', (req, res) => {
        if (!req.session.user) return res.redirect('/');
        res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    });

    app.get('/admin', (req, res) => {
        if (!req.session.user) return res.redirect('/');
        if (!isUserAdmin(req.session.user)) return res.redirect('/dashboard');
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    });

    // Marquer isAdmin dans la session user
    app.use((req, res, next) => {
        if (req.session.user) {
            req.session.user.isAdmin = isUserAdmin(req.session.user);
        }
        next();
    });

    // Enregistrer les endpoints crafts
    try {
        registerCraftEndpoints(app, requireAuth, requireAdmin, botClient, botState);
        console.log('🔫 Endpoints crafts enregistrés');
    } catch (e) {
        console.error('❌ Erreur endpoints crafts:', e.message);
    }

    app.post('/api/admin/clips/backfill', requireAdmin, async (req, res) => {
        try {
            if (!botClient?.isReady?.()) {
                return res.status(503).json({ error: 'Bot Discord non pret pour le backfill clips' });
            }
            backfillClipForum(botClient).catch(e => console.error(`[clips] backfill background echoue: ${e.message}`));
            res.json({ success: true, status: getBackfillStatus() });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/clips/backfill/status', requireAdmin, (req, res) => {
        try {
            res.json({ status: getBackfillStatus() });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/clip-backups', requireAdmin, (req, res) => {
        try {
            res.json({ clips: getRecentClipBackups(req.query.limit) });
        } catch (e) {
            res.status(500).json({ clips: [], error: e.message });
        }
    });

    // ==========================================
    // API
    // ==========================================
    app.get('/api/me', requireAuth, (req, res) => {
        const user = { ...req.session.user, isAdmin: isUserAdmin(req.session.user) };
        res.json(user);
    });

    // Données présence en temps réel
    app.get('/api/presence', requireAuth, requireFullSiteAccess, async (req, res) => {
        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
        if (!guild) return res.json({ error: 'Guild not found' });

        const role = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1);
        if (!role) return res.json({ error: 'Role not found' });

        const collectFromOP = (data, reactionMap) => {
            const result = {
                active: data.active,
                terminated: false,
                present: [], late: [], absentReact: [], absentValid: [], noReaction: [],
            };

            if (!data.active || !data.messageId) return result;

            for (const [, member] of role.members) {
                if (member.user.bot) continue;
                if (member.roles.cache.has(state.CONFIG.ROLES.EXCLUDED_ROLE)) continue;

                const name = member.nickname || member.user.username;
                const m = { id: member.id, name, avatar: member.user.avatar ? `https://cdn.discordapp.com/avatars/${member.id}/${member.user.avatar}.png?size=64` : null };
                const reaction = reactionMap.get(member.id);

                if (reaction === 'check') result.present.push(m);
                else if (reaction === 'retard') result.late.push(m);
                else if (reaction === 'no') result.absentReact.push(m);
                else if (state.absenceSalonCache.validAbsences.has(member.id)) result.absentValid.push(m);
                else result.noReaction.push(m);
            }

            return result;
        };

        res.json({
            op1: collectFromOP(state.presenceData, state.reactionsOP1),
            op2: collectFromOP(state.presence2Data, state.reactionsOP2),
            absencesSalon: {
                valid: state.absenceSalonCache.validAbsenceNames || [],
                invalid: state.absenceSalonCache.invalidAbsenceNames || [],
            },
        });
    });

    // Suivi hebdomadaire
    app.get('/api/weekly', requireAuth, requireFullSiteAccess, async (req, res) => {
        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);

        const tracking = await Promise.all([...state.absenceTracking.entries()].map(async ([id, data]) => {
            let avatar = null;
            if (guild) {
                try {
                    const member = await guild.members.fetch(id).catch(() => null);
                    if (member) {
                        avatar = member.user.avatar
                            ? `https://cdn.discordapp.com/avatars/${id}/${member.user.avatar}.png?size=64`
                            : null;
                    }
                } catch {}
            }
            return {
                id,
                username: data.username,
                avatar,
                count: data.count,
                details: data.details || [],
                consecutiveDays: state.getConsecutiveDays(data),
            };
        }));

        tracking.sort((a, b) => b.count - a.count);
        res.json({ tracking });
    });

    // Lancer une commande / alerte
    app.post('/api/command', requireAuth, requireFullSiteAccess, async (req, res) => {
        const { command, params } = req.body;
        const state = botState();

        try {
            const qgChannel = botClient.channels.cache.get(state.CONFIG.CHANNELS.QG);
            const radioChannel = botClient.channels.cache.get(state.CONFIG.CHANNELS.RADIO);
            const bmChannel = botClient.channels.cache.get(state.CONFIG.CHANNELS.BM_NOTIF);

            switch (command) {
                case 'qg':
                case 'garage':
                case 'alignement':
                case 'tir':
                case 'position':
                case 'defense':
                case 'weed':
                case 'traitement-weed':
                case 'yellowjack':
                case 'megamall':
                case 'ile':
                case 'trash': {
                    const messages = {
                        qg: `<@&${state.CONFIG.ROLES.MEMBRE_1}> 🚨 Rendez-vous au Hood ! Vous avez 5 minutes ! ${state.CONFIG.EMOJIS.BS21}`,
                        garage: `🚨 Rendez-vous au Garage Hood ! Vous avez 5 minutes ! ${state.CONFIG.EMOJIS.BS21}`,
                        alignement: `🚨 Merci de venir vous alignez ! Vous avez 3 minutes ! ${state.CONFIG.EMOJIS.BS21}`,
                        tir: `🚨 Merci d'arrêter de tirer ! ${state.CONFIG.EMOJIS.BS21}`,
                        position: `🚨 Merci de prendre des positions ! ${state.CONFIG.EMOJIS.BS21}`,
                        defense: `<@&${state.CONFIG.ROLES.MEMBRE_1}> 🚨 Notre **laboratoire se fait attaquer** ! Tous au Hood dans 5 Minutes ! ${state.CONFIG.EMOJIS.BS21}`,
                        weed: `🚨 On va aller sur la weed ! Branchez-vous sur la radio ! ${state.CONFIG.EMOJIS.BS21}`,
                        'traitement-weed': `🚨 On va aller sur le traitement de la weed ! Branchez-vous sur la radio ! ${state.CONFIG.EMOJIS.BS21}`,
                        yellowjack: `<@&${state.CONFIG.ROLES.MEMBRE_1}> 🚨 Merci de venir à côté du Yellow Jack ${state.CONFIG.EMOJIS.BS21}`,
                        megamall: `<@&${state.CONFIG.ROLES.MEMBRE_1}> 🚨 Merci de venir au parking Mega Mall ${state.CONFIG.EMOJIS.BS21}`,
                        ile: `<@&${state.CONFIG.ROLES.MEMBRE_1}> 🚨 Merci de venir à côté de l'Ile ${state.CONFIG.EMOJIS.BS21}`,
                        trash: `🚨 Celui qui trash sera ban sans sommation ! ${state.CONFIG.EMOJIS.BS21}`,
                    };

                    if (!qgChannel) return res.status(500).json({ error: 'Salon QG introuvable' });

                    const msg = messages[command];
                    const sent = [];
                    for (let i = 0; i < 15; i++) {
                        const m = await qgChannel.send({ content: msg, allowedMentions: { parse: ['roles'] } });
                        sent.push(m);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    setTimeout(() => { for (const m of sent) m.delete().catch(() => {}); }, 120_000);

                    return res.json({ success: true, sent: sent.length });
                }

                case 'radio': {
                    if (!radioChannel) return res.status(500).json({ error: 'Salon radio introuvable' });
                    const freq = `${String(Math.floor(Math.random() * 98) + 1).padStart(2, '0')}.${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
                    await radioChannel.send({
                        content: `Voici la nouvelle Radio <@&${state.CONFIG.ROLES.MEMBRE_1}> : **${freq}**\nMerci de vous connecter dessus ! ${state.CONFIG.EMOJIS.BS21}`,
                        allowedMentions: { parse: ['roles'] }
                    });
                    return res.json({ success: true, frequency: freq });
                }

                case 'presence': {
                    if (state.presenceData.active) return res.status(400).json({ error: 'Présence OP déjà active' });
                    await state.sendPresenceMessage();
                    return res.json({ success: true });
                }

                case 'presence2': {
                    await state.sendPresence2Message();
                    return res.json({ success: true });
                }

                case 'annonce': {
                    if (!bmChannel) return res.status(500).json({ error: 'Salon BM introuvable' });
                    const { roleId, message, useEmbed } = params || {};
                    if (!roleId || !message) return res.status(400).json({ error: 'roleId et message requis' });

                    if (useEmbed) {
                        // Mode embed : jusqu'à 4096 caractères dans description
                        if (message.length > 4000) return res.status(400).json({ error: 'Message trop long (max 4000)' });
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setDescription(message.replace(/\\n/g, '\n'))
                            .setColor(0xff8c00)
                            .setTimestamp();
                        await bmChannel.send({
                            content: `||<@&${roleId}>||`,
                            embeds: [embed],
                            allowedMentions: { parse: ['roles'] }
                        });
                    } else {
                        // Mode message classique : 2000 max
                        if (message.length > 2000) return res.status(400).json({ error: 'Message trop long (max 2000)' });
                        await bmChannel.send({
                            content: `${message.replace(/\\n/g, '\n')}\n\n||<@&${roleId}>||`,
                            allowedMentions: { parse: ['roles'] }
                        });
                    }
                    return res.json({ success: true });
                }

                case 'rappel': {
                    const rappelChannel = botClient.channels.cache.get(state.CONFIG.CHANNELS.RAPPELS_PANEL);
                    if (!rappelChannel) return res.status(500).json({ error: 'Salon rappels introuvable' });
                    const { roleId, message, useEmbed } = params || {};
                    if (!roleId || !message) return res.status(400).json({ error: 'roleId et message requis' });

                    if (useEmbed) {
                        if (message.length > 4000) return res.status(400).json({ error: 'Message trop long (max 4000)' });
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setDescription(message.replace(/\\n/g, '\n'))
                            .setColor(0x5865f2)
                            .setTimestamp();
                        await rappelChannel.send({
                            content: `||<@&${roleId}>||`,
                            embeds: [embed],
                            allowedMentions: { parse: ['roles'] }
                        });
                    } else {
                        if (message.length > 2000) return res.status(400).json({ error: 'Message trop long (max 2000)' });
                        await rappelChannel.send({
                            content: `${message.replace(/\\n/g, '\n')}\n\n||<@&${roleId}>||`,
                            allowedMentions: { parse: ['roles'] }
                        });
                    }
                    return res.json({ success: true });
                }

                case 'sanction': {
                    const sanctionChannel = botClient.channels.cache.get(state.CONFIG.CHANNELS.SANCTION);
                    if (!sanctionChannel) return res.status(500).json({ error: 'Salon sanction introuvable' });
                    const { userId, raison } = params || {};
                    if (!userId || !raison) return res.status(400).json({ error: 'userId et raison requis' });

                    const cleanId = userId.replace(/[<@!>]/g, '').trim();
                    const mention = /^\d{17,20}$/.test(cleanId) ? `<@${cleanId}>` : userId;
                    const attentionEmoji = state.CONFIG.EMOJIS?.ATTENTION || '⚠️';
                    const bs21Emoji = state.CONFIG.EMOJIS?.BS21 || '';

                    await sanctionChannel.send(`${mention} Vous avez reçu un **avertissement** pour la raison suivante : ${raison} ${attentionEmoji} ${bs21Emoji}`);
                    return res.json({ success: true });
                }

                default:
                    return res.status(400).json({ error: 'Commande inconnue' });
            }
        } catch (e) {
            console.error('❌ API command erreur:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // Liste des sanctions/avertissements (depuis les channels)
    app.get('/api/sanctions', requireAuth, async (req, res) => {
        const state = botState();
        try {
            const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
            const channelIds = [
                state.CONFIG.CHANNELS.AVERTISSEMENT,
                state.CONFIG.CHANNELS.SANCTION,
            ].filter(Boolean);
            const seen = new Set();
            const allMessages = [];
            for (const channelId of channelIds) {
                if (seen.has(channelId)) continue;
                seen.add(channelId);
                const channel = botClient.channels.cache.get(channelId);
                if (!channel) continue;
                const messages = await channel.messages.fetch({ limit: 100 });
                allMessages.push(...messages.values());
            }

            const sanctions = await Promise.all(allMessages
                .filter(m => m.author.bot)
                .map(async m => {
                    let content = m.content;

                    // 1. Résoudre <@&roleId> → @@ROLE@name@color@@
                    content = content.replace(/<@&(\d+)>/g, (match, id) => {
                        const role = guild?.roles.cache.get(id);
                        if (!role) return match;
                        const color = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '';
                        return `@@ROLE@${role.name}@${color}@@`;
                    });

                    // 2. Résoudre <@!?userId> → @@USER@id@name@color@@
                    const userMatches = [...content.matchAll(/<@!?(\d+)>/g)];
                    const mentionedUsers = [];
                    for (const um of userMatches) {
                        const userId = um[1];
                        try {
                            const member = await guild?.members.fetch(userId).catch(() => null);
                            if (member) {
                                const name = member.nickname || member.user.username;
                                const avatar = member.user.avatar
                                    ? `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png?size=32`
                                    : null;
                                const color = member.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : '';
                                mentionedUsers.push({ id: userId, name, avatar, color });
                                content = content.replace(um[0], `@@USER@${userId}@${name}@${color}@@`);
                            }
                        } catch {}
                    }

                    // 3. Emojis customs <:name:id> → @@EMOJI@id@name@a@@
                    content = content.replace(/<(a?):(\w+):(\d+)>/g, (match, animated, name, id) => {
                        return `@@EMOJI@${id}@${name}@${animated ? 'a' : ''}@@`;
                    });

                    return {
                        id: m.id,
                        content,
                        rawContent: m.content,
                        mentionedUsers,
                        createdAt: m.createdAt,
                        timestamp: m.createdTimestamp,
                        channelId: m.channelId,
                    };
                }));
            sanctions.sort((a, b) => b.timestamp - a.timestamp);

            res.json({ sanctions });
        } catch (e) {
            res.json({ sanctions: [], error: e.message });
        }
    });

    // Reset le suivi d'un membre
    app.post('/api/tracking/reset', requireAuth, requireFullSiteAccess, (req, res) => {
        const { userId } = req.body;
        const state = botState();
        if (state.absenceTracking.has(userId)) {
            state.absenceTracking.delete(userId);
            state.saveAbsenceTracking();
            return res.json({ success: true });
        }
        res.status(404).json({ error: 'User not in tracking' });
    });

    // Stats globales
    app.get('/api/stats', requireAuth, requireFullSiteAccess, async (req, res) => {
        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);

        // Forcer le fetch complet des membres pour avoir les bons counts
        if (guild) {
            try { await guild.members.fetch(); } catch {}
        }

        const summarizeMember = (member, extra = {}) => ({
            id: member.id,
            username: member.nickname || member.user.username,
            avatar: member.user.avatar
                ? `https://cdn.discordapp.com/avatars/${member.id}/${member.user.avatar}.png?size=64`
                : null,
            color: member.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
            ...extra,
        });

        // Total = membres ayant MEMBRE_1 OU MEMBRE_2
        let totalMembers = 0;
        let totalMembersList = [];
        if (guild) {
            const counted = new Set();
            const role1 = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1);
            const role2 = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_2);
            if (role1) for (const [id, m] of role1.members) if (!m.user.bot) counted.add(id);
            if (role2) for (const [id, m] of role2.members) if (!m.user.bot) counted.add(id);
            totalMembers = counted.size;
            totalMembersList = [...counted]
                .map(id => guild.members.cache.get(id))
                .filter(Boolean)
                .map(member => summarizeMember(member))
                .sort((a, b) => a.username.localeCompare(b.username, 'fr'));
        }

        const role = guild ? guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1) : null;
        const inscritsOP = role ? role.members.filter(m => !m.user.bot).size : 0;
        const inscritsList = role
            ? [...role.members.values()]
                .filter(m => !m.user.bot)
                .map(member => summarizeMember(member))
                .sort((a, b) => a.username.localeCompare(b.username, 'fr'))
            : [];

        const trackingEntries = [...state.absenceTracking.entries()];
        const tracking = trackingEntries.map(([, t]) => t);
        const totalUnjustified = tracking.reduce((sum, t) => sum + t.count, 0);
        const withConsecutive = tracking.filter(t => state.getConsecutiveDays(t) >= 2).length;
        const absenceMembers = trackingEntries.map(([id, t]) => {
            const member = guild?.members.cache.get(id);
            return {
                id,
                username: t.username || member?.nickname || member?.user?.username || id,
                avatar: member?.user?.avatar ? `https://cdn.discordapp.com/avatars/${id}/${member.user.avatar}.png?size=64` : null,
                color: member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
                count: t.count || 0,
                consecutiveDays: state.getConsecutiveDays(t),
                dates: t.dates || [],
                details: t.details || [],
            };
        }).sort((a, b) => (b.count - a.count) || a.username.localeCompare(b.username, 'fr'));
        const kpMembers = absenceMembers.filter(m => m.consecutiveDays >= 2);

        res.json({
            totalMembers,
            inscritsOP,
            totalUnjustified,
            membersWithAbsences: tracking.length,
            membersWithConsecutive: withConsecutive,
            totalMembersList,
            inscritsList,
            absenceMembers,
            kpMembers,
            op1Active: state.presenceData.active,
            op2Active: state.presence2Data.active,
        });
    });

    // ==========================================
    // API — Salons Discord
    // ==========================================
    app.get('/api/channels', requireAuth, async (req, res) => {
        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
        if (!guild) return res.json({ categories: [] });

        try {
            const channels = guild.channels.cache;
            const impersonateRole = req.query.impersonate;
            const canImpersonate = !!impersonateRole && isUserAdmin(req.session.user);
            const impersonatedRole = canImpersonate ? guild.roles.cache.get(impersonateRole) : null;
            const canSeeChannel = (ch) => {
                if (canImpersonate) return canRoleViewChannel(ch, impersonatedRole);
                return userCanViewChannel(ch, req.session.user);
            };
            const categories = [];
            const orphans = [];

            // Collecter les catégories
            for (const [, ch] of channels) {
                if (ch.type === 4) { // CategoryChannel
                    if (!canSeeChannel(ch)) continue;
                    categories.push({
                        id: ch.id,
                        name: ch.name,
                        position: ch.position,
                        channels: [],
                    });
                }
            }

            // Trier les catégories par position
            categories.sort((a, b) => a.position - b.position);

            // Assigner les salons aux catégories
            for (const [, ch] of channels) {
                if (ch.type === 4) continue; // Skip catégories elles-mêmes
                if (!canSeeChannel(ch)) continue;

                const channelData = {
                    id: ch.id,
                    name: ch.name,
                    type: ch.type, // 0 = text, 2 = voice, 5 = announcement, 13 = stage, 15 = forum
                    typeLabel: getChannelTypeLabel(ch.type),
                    position: ch.position,
                    topic: ch.topic || null,
                    nsfw: ch.nsfw || false,
                    url: `https://discord.com/channels/${state.CONFIG.GUILD_ID}/${ch.id}`,
                };

                if (ch.parentId) {
                    const cat = categories.find(c => c.id === ch.parentId);
                    if (cat) cat.channels.push(channelData);
                } else {
                    orphans.push(channelData);
                }
            }

            // Trier les salons dans chaque catégorie
            for (const cat of categories) {
                cat.channels.sort((a, b) => a.position - b.position);
            }
            orphans.sort((a, b) => a.position - b.position);

            res.json({ categories: categories.filter(cat => cat.channels.length > 0 || canSeeChannel(channels.get(cat.id))), orphans, guildId: state.CONFIG.GUILD_ID });
        } catch (e) {
            res.json({ error: e.message, categories: [] });
        }
    });

    function getChannelTypeLabel(type) {
        const types = {
            0: 'text',
            2: 'voice',
            4: 'category',
            5: 'announcement',
            10: 'thread',
            11: 'thread',
            12: 'thread',
            13: 'stage',
            15: 'forum',
        };
        return types[type] || 'unknown';
    }

    // ==========================================
    // API — Historique messages d'un salon
    // ==========================================
    app.get('/api/channel/:id/messages', requireAuth, async (req, res) => {
        const channelId = req.params.id;
        const before = req.query.before;
        const after = req.query.after;

        try {
            const channel = await fetchDiscordChannel(channelId);
            if (!channel) return res.status(404).json({ error: 'Salon introuvable' });
            if (!userCanViewChannel(channel, req.session.user)) {
                return res.status(403).json({ error: 'Acces au salon refuse' });
            }

            // Forums : on retourne les threads à la place des messages
            if (channel.type === 15) {
                const activeThreads = await channel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                const archivedThreads = await channel.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));

                const allThreads = [
                    ...[...activeThreads.threads.values()],
                    ...[...archivedThreads.threads.values()],
                ];

                const threads = await Promise.all(allThreads.map(async t => {
                    let firstMessage = null;
                    try {
                        // Le starter message d'un thread de forum a le même ID que le thread
                        const starterMsg = await t.fetchStarterMessage().catch(() => null);
                        if (starterMsg) {
                            firstMessage = starterMsg;
                        } else {
                            // Fallback : récupérer le premier message du thread
                            const messages = await t.messages.fetch({ limit: 1 }).catch(() => null);
                            if (messages && messages.size > 0) {
                                firstMessage = messages.first();
                            }
                        }
                    } catch {}

                    let firstMessageData = null;
                    if (firstMessage) {
                        firstMessageData = {
                            content: firstMessage.content,
                            authorId: firstMessage.author.id,
                            authorName: firstMessage.member?.nickname || firstMessage.author.username,
                            authorAvatar: firstMessage.author.avatar
                                ? `https://cdn.discordapp.com/avatars/${firstMessage.author.id}/${firstMessage.author.avatar}.png?size=64`
                                : null,
                            attachments: [...firstMessage.attachments.values()].map(a => ({
                                url: a.url,
                                name: a.name,
                                size: a.size,
                                contentType: a.contentType,
                                isImage: a.contentType?.startsWith('image/') || false,
                                isVideo: a.contentType?.startsWith('video/') || false,
                            })),
                            embeds: firstMessage.embeds.map(e => ({
                                title: e.title,
                                description: e.description,
                                url: e.url,
                                image: e.image?.url,
                                thumbnail: e.thumbnail?.url,
                                video: e.video?.url,
                            })),
                        };
                    }

                    return {
                        id: t.id,
                        name: t.name,
                        archived: t.archived,
                        messageCount: t.messageCount,
                        memberCount: t.memberCount,
                        createdTimestamp: t.createdTimestamp,
                        firstMessage: firstMessageData,
                    };
                }));

                return res.json({
                    type: 'forum',
                    threads: threads.sort((a, b) => b.createdTimestamp - a.createdTimestamp),
                    channelName: channel.name,
                });
            }

            // Salons texte normaux
            if (channel.type !== 0 && channel.type !== 5 && channel.type !== 11 && channel.type !== 12) {
                return res.status(400).json({ error: 'Ce type de salon ne supporte pas les messages' });
            }

            const fetchOptions = { limit: 100 };
            if (before) fetchOptions.before = before;
            if (after && after !== '0') fetchOptions.after = after;

            const guild = botClient.guilds.cache.get(botState().CONFIG.GUILD_ID);
            const messages = await channel.messages.fetch(fetchOptions);

            const result = await Promise.all([...messages.values()].map(async m => {
                // Construire la liste des mentions avec noms RÉSOLUS et couleurs
                const userMentions = await Promise.all([...m.mentions.users.values()].map(async u => {
                    const member = await guild?.members.fetch(u.id).catch(() => null);
                    const displayColor = member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null;
                    return {
                        id: u.id,
                        name: member?.nickname || u.username,
                        color: displayColor,
                    };
                }));

                // Couleur de l'auteur
                const authorMember = m.member;
                const authorColor = authorMember?.displayHexColor && authorMember.displayHexColor !== '#000000' ? authorMember.displayHexColor : null;

                return {
                    id: m.id,
                    content: m.content,
                    authorId: m.author.id,
                    authorName: m.member?.nickname || m.author.username,
                    authorAvatar: m.author.avatar
                        ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64`
                        : null,
                    authorBot: m.author.bot,
                    authorColor: authorColor,
                    createdTimestamp: m.createdTimestamp,
                    editedTimestamp: m.editedTimestamp,
                    attachments: [...m.attachments.values()].map(a => ({
                        url: a.url,
                        name: a.name,
                        size: a.size,
                        contentType: a.contentType,
                        isImage: a.contentType?.startsWith('image/') || false,
                        isVideo: a.contentType?.startsWith('video/') || false,
                    })),
                    embeds: m.embeds.map(e => ({
                        title: e.title,
                        description: e.description,
                        url: e.url,
                        color: e.color,
                        image: e.image?.url,
                        thumbnail: e.thumbnail?.url,
                        fields: e.fields,
                    })),
                    pinned: m.pinned,
                    mentions: {
                        users: userMentions,
                        roles: [...m.mentions.roles.values()].map(r => ({ id: r.id, name: r.name, color: r.color })),
                    },
                    reactions: [...m.reactions.cache.values()].map(r => ({
                        emoji: r.emoji.id ? `<${r.emoji.animated ? 'a' : ''}:${r.emoji.name}:${r.emoji.id}>` : r.emoji.name,
                        emojiUrl: r.emoji.id ? `https://cdn.discordapp.com/emojis/${r.emoji.id}.${r.emoji.animated ? 'gif' : 'png'}` : null,
                        emojiName: r.emoji.name,
                        count: r.count,
                    })),
                };
            }));

            res.json({
                type: 'text',
                messages: result,
                hasMore: result.length === 100,
                channelName: channel.name,
            });
        } catch (e) {
            console.error('❌ /api/channel/messages:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // API — Messages épinglés
    // ==========================================
    // ==========================================
    // API — Envoyer un message dans un salon (via webhook)
    // ==========================================
    app.post('/api/channel/:id/send', requireAuth, async (req, res) => {
        const channelId = req.params.id;
        const { content } = req.body;

        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            return res.status(400).json({ error: 'Message vide' });
        }
        if (content.length > 2000) {
            return res.status(400).json({ error: 'Message trop long (max 2000 caractères)' });
        }

        try {
            const channel = await fetchDiscordChannel(channelId);
            if (!channel) return res.status(404).json({ error: 'Salon introuvable' });
            if (!userCanSendToChannel(channel, req.session.user)) {
                return res.status(403).json({ error: 'Permission d\'envoi refusee pour ce salon' });
            }

            // Threads : on envoie directement dans le thread
            const isThread = [10, 11, 12].includes(channel.type);
            if (![0, 5].includes(channel.type) && !isThread) {
                return res.status(400).json({ error: 'Ce salon ne supporte pas l\'envoi de messages' });
            }

            // Pour un thread, on récupère le webhook du salon parent
            const webhookChannel = isThread ? channel.parent : channel;
            if (!webhookChannel) return res.status(400).json({ error: 'Salon parent introuvable' });

            // Récupérer ou créer le webhook
            let webhook;
            try {
                const webhooks = await webhookChannel.fetchWebhooks();
                webhook = webhooks.find(w => w.name === '21BS Web Dashboard');
                if (!webhook) {
                    webhook = await webhookChannel.createWebhook({
                        name: '21BS Web Dashboard',
                        reason: 'Webhook pour l\'envoi de messages depuis le dashboard',
                    });
                }
            } catch (e) {
                console.error('❌ Webhook erreur:', e.message);
                return res.status(500).json({ error: 'Impossible de créer/récupérer le webhook (permissions manquantes ?)' });
            }

            // Envoyer le message avec l'identité de l'utilisateur
            await webhook.send({
                content,
                username: req.session.user.username,
                avatarURL: req.session.user.avatar || undefined,
                threadId: isThread ? channelId : undefined,
                allowedMentions: {
                    parse: hasFullSiteAccess(req.session.user) ? ['users', 'roles'] : [],
                },
            });

            res.json({ success: true });
        } catch (e) {
            console.error('❌ /api/channel/send:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // API — Recherche de membres (pour @mentions)
    // ==========================================
    app.get('/api/members/search', requireAuth, async (req, res) => {
        const query = (req.query.q || '').toLowerCase().trim();
        if (query.length < 1) return res.json({ members: [] });

        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
        if (!guild) return res.json({ members: [] });

        const members = [...guild.members.cache.values()]
            .filter(m => !m.user.bot)
            .filter(m => {
                const name = (m.nickname || m.user.username).toLowerCase();
                return name.includes(query);
            })
            .slice(0, 10)
            .map(m => ({
                id: m.id,
                name: m.nickname || m.user.username,
                avatar: m.user.avatar
                    ? `https://cdn.discordapp.com/avatars/${m.id}/${m.user.avatar}.png?size=32`
                    : null,
            }));

        res.json({ members });
    });

    // ==========================================
    // API — Tous les membres du serveur (pour dropdown)
    // ==========================================
    app.get('/api/members/all', requireAuth, async (req, res) => {
        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
        if (!guild) return res.json({ members: [] });

        try {
            // Forcer un fetch complet
            await guild.members.fetch().catch(() => {});

            const members = [...guild.members.cache.values()]
                .filter(m => !m.user.bot)
                .map(m => ({
                    id: m.id,
                    name: m.nickname || m.user.username,
                    username: m.user.username,
                    avatar: m.user.avatar
                        ? `https://cdn.discordapp.com/avatars/${m.id}/${m.user.avatar}.png?size=32`
                        : null,
                    color: m.displayHexColor && m.displayHexColor !== '#000000' ? m.displayHexColor : null,
                }))
                .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

            res.json({ members });
        } catch (e) {
            res.json({ members: [], error: e.message });
        }
    });

    app.get('/api/channel/:id/pinned', requireAuth, async (req, res) => {
        try {
            const channel = await fetchDiscordChannel(req.params.id);
            if (!channel) return res.status(404).json({ error: 'Salon introuvable' });
            if (!userCanViewChannel(channel, req.session.user)) {
                return res.status(403).json({ error: 'Acces au salon refuse' });
            }

            const pinned = await channel.messages.fetchPinned();
            const result = [...pinned.values()].map(m => ({
                id: m.id,
                content: m.content,
                authorName: m.member?.nickname || m.author.username,
                authorAvatar: m.author.avatar ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png` : null,
                createdTimestamp: m.createdTimestamp,
            }));
            res.json({ pinned: result });
        } catch (e) {
            res.json({ pinned: [], error: e.message });
        }
    });

    // ==========================================
    // API — Liste des commandes disponibles (pour mise à jour auto du site)
    // ==========================================
    app.get('/api/commands', requireAuth, (req, res) => {
        const commands = [
            // Alertes terrain
            { id: 'qg', icon: '📍', name: 'QG', desc: 'Rendez-vous au Hood (5 min)', category: 'alert', danger: true },
            { id: 'defense', icon: '🔥', name: 'Défense Labo', desc: 'Laboratoire attaqué', category: 'alert', danger: true },
            { id: 'garage', icon: '🏗', name: 'Garage', desc: 'Rendez-vous au Garage Hood', category: 'alert' },
            { id: 'alignement', icon: '📐', name: 'Alignement', desc: '3 minutes pour s\'aligner', category: 'alert' },
            { id: 'position', icon: '🎯', name: 'Positions', desc: 'Prendre des positions', category: 'alert' },
            { id: 'tir', icon: '✋', name: 'Stop Tir', desc: 'Arrêter de tirer', category: 'alert' },
            { id: 'weed', icon: '🌿', name: 'Weed', desc: 'Aller sur la weed', category: 'alert' },
            { id: 'traitement-weed', icon: '⚗', name: 'Traitement', desc: 'Traitement de la weed', category: 'alert' },
            { id: 'yellowjack', icon: '🟡', name: 'Yellow Jack', desc: 'Rassemblement Yellow Jack', category: 'alert' },
            { id: 'megamall', icon: '🅿', name: 'Mega Mall', desc: 'Parking Mega Mall', category: 'alert' },
            { id: 'ile', icon: '🏝', name: 'Ile', desc: 'Rassemblement près de l’Ile', category: 'alert' },
            { id: 'trash', icon: '🚫', name: 'Anti-Trash', desc: 'Avertissement trash', category: 'alert' },
            // Communications
            { id: 'radio', icon: '📻', name: 'Nouvelle Radio', desc: 'Fréquence aléatoire', category: 'comm', info: true },
            { id: 'presence', icon: '📋', name: '1ère Présence OP', desc: 'Lancer la présence', category: 'comm', info: true },
            { id: 'presence2', icon: '📋', name: '2ème Présence OP', desc: 'Sans relances', category: 'comm', info: true },
        ];
        res.json({ commands });
    });

    // ==========================================
    // API — Liste des rôles (pour /annonce et carte)
    // ==========================================
    app.get('/api/roles', requireAuth, (req, res) => {
        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
        if (!guild) return res.json({ roles: [] });

        const roles = [...guild.roles.cache.values()]
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
                position: r.position,
                memberCount: r.members.size,
                mentionable: r.mentionable,
                managed: r.managed,
            }));

        res.json({ roles });
    });

    // ==========================================
    // API — Liste des emojis du serveur
    // ==========================================
    app.get('/api/emojis', requireAuth, (req, res) => {
        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
        if (!guild) return res.json({ emojis: [] });

        const emojis = [...guild.emojis.cache.values()].map(e => ({
            id: e.id,
            name: e.name,
            animated: e.animated,
            url: e.url,
            code: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`,
        }));

        res.json({ emojis });
    });

    // ==========================================
    // API — Carte interactive (points)
    // ==========================================
    fs.mkdirSync(config.paths.data, { recursive: true });
    const MAP_POINTS_FILE = path.join(config.paths.data, 'map_points.json');

    function loadMapPoints() {
        try {
            if (fs.existsSync(MAP_POINTS_FILE)) {
                return JSON.parse(fs.readFileSync(MAP_POINTS_FILE, 'utf8'));
            }
        } catch {}
        return [];
    }

    function saveMapPoints(points) {
        try {
            fs.writeFileSync(MAP_POINTS_FILE, JSON.stringify(points, null, 2));
        } catch (e) {
            console.error('❌ Erreur sauvegarde map points:', e.message);
        }
    }

    app.get('/api/map/points', requireAuth, (req, res) => {
        const userId = req.session.user?.id;
        let userRoles = req.session.user?.roles || [];

        // Mode impersonate : remplacer les rôles par celui demandé
        const impersonateRole = req.query.impersonate;
        const isAdmin = isUserAdmin(req.session.user);
        const isImpersonating = !!impersonateRole && isAdmin;
        const effectiveUserId = isImpersonating ? '__impersonate__' : userId;
        const effectiveRoles = isImpersonating ? [impersonateRole] : userRoles;

        // Laboratoire d'armes : visible pour les 3 user IDs OU les 3 rôles hauts gradés
        const LAB_VISIBLE_USERS = ['952986899667103804', '780164840798552066', '769670622380294265'];
        const FULL_ACCESS_ROLES = ['1485279148246175764', '1486744891848654988', '1485279534650494976'];
        const canSeeLab = isImpersonating
            ? FULL_ACCESS_ROLES.includes(impersonateRole)
            : (
                LAB_VISIBLE_USERS.includes(userId) ||
                FULL_ACCESS_ROLES.some(r => userRoles.includes(r))
            );

        const allPoints = loadMapPoints();

        const visiblePoints = allPoints.filter(p => {
            // Type weapon-lab : visibilité réservée
            if (p.type === 'weapon-lab') {
                return canSeeLab;
            }

            // Pas de restriction de rôles → visible
            if ((!p.allowedRoles || p.allowedRoles.length === 0) &&
                (!p.allowedUsers || p.allowedUsers.length === 0)) {
                return true;
            }

            // Restriction par utilisateur spécifique
            if (p.allowedUsers && p.allowedUsers.length > 0) {
                if (p.allowedUsers.includes(effectiveUserId)) return true;
            }

            // Restriction par rôle
            if (p.allowedRoles && p.allowedRoles.length > 0) {
                return p.allowedRoles.some(r => effectiveRoles.includes(r));
            }

            return false;
        });

        res.json({ points: visiblePoints, impersonating: isImpersonating });
    });

    // Vérifier permissions de placer des points (mêmes que COMMAND_ROLES par défaut)
    function canEditMap(req) {
        const userId = req.session.user?.id;
        if (userId === '952986899667103804') return true;
        const userRoles = req.session.user?.roles || [];
        const FULL_ACCESS = ['1485279148246175764', '1486744891848654988', '1485279534650494976'];
        return FULL_ACCESS.some(r => userRoles.includes(r));
    }

    app.post('/api/map/points', requireAuth, (req, res) => {
        if (!canEditMap(req)) return res.status(403).json({ error: 'Permissions insuffisantes pour modifier la carte' });

        const { x, y, label, type, allowedRoles, allowedUsers, code } = req.body;
        if (typeof x !== 'number' || typeof y !== 'number') {
            return res.status(400).json({ error: 'Coordonnées invalides' });
        }

        const points = loadMapPoints();
        const point = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            x, y,
            label: label || 'Point',
            type: type || 'weed',
            code: ['lab', 'weapon-lab'].includes(type) ? (code || '').trim().slice(0, 50) : null,
            allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [],
            allowedUsers: Array.isArray(allowedUsers) ? allowedUsers : [],
            createdBy: req.session.user.username,
            createdById: req.session.user.id,
            createdAt: Date.now(),
        };
        points.push(point);
        saveMapPoints(points);
        res.json({ success: true, point });
    });

    app.delete('/api/map/points/:id', requireAuth, (req, res) => {
        if (!canEditMap(req)) return res.status(403).json({ error: 'Permissions insuffisantes' });

        const points = loadMapPoints();
        const filtered = points.filter(p => p.id !== req.params.id);
        if (filtered.length === points.length) return res.status(404).json({ error: 'Point introuvable' });
        saveMapPoints(filtered);
        res.json({ success: true });
    });

    app.put('/api/map/points/:id', requireAuth, (req, res) => {
        if (!canEditMap(req)) return res.status(403).json({ error: 'Permissions insuffisantes' });

        const points = loadMapPoints();
        const point = points.find(p => p.id === req.params.id);
        if (!point) return res.status(404).json({ error: 'Point introuvable' });

        const { x, y, label, type, color, code, allowedRoles } = req.body;
        if (typeof x === 'number') point.x = x;
        if (typeof y === 'number') point.y = y;
        if (label !== undefined) point.label = label;
        if (type !== undefined) point.type = type;
        if (color !== undefined) point.color = color;
        if (code !== undefined && ['lab', 'weapon-lab'].includes(point.type)) {
            point.code = (code || '').trim().slice(0, 50);
        }
        if (Array.isArray(allowedRoles)) point.allowedRoles = allowedRoles;
        point.updatedAt = Date.now();
        point.updatedBy = req.session.user.username;

        saveMapPoints(points);
        res.json({ success: true, point });
    });

    // Permissions de l'utilisateur courant
    app.get('/api/me/permissions', requireAuth, (req, res) => {
        res.json({
            canEditMap: canEditMap(req),
            isAdmin: isUserAdmin(req.session.user),
        });
    });

    // Vérifier si l'user actuel est admin
    app.get('/api/admin/check', requireAuth, (req, res) => {
        res.json({ isAdmin: isUserAdmin(req.session.user) });
    });

    app.listen(PORT, () => {
        console.log(`🌐 Dashboard web démarré sur le port ${PORT}`);
    });
}

module.exports = { startServer };
