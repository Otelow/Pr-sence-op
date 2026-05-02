// ==========================================
// Serveur web — Dashboard 21 Block Savage
// ==========================================

const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-please-' + Math.random();

let botClient;
let botState;

function startServer(client, getState) {
    botClient = client;
    botState = getState;

    const app = express();

    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 jours
    }));

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

        const errorPage = (msg) => `
<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Accès refusé — 21 Block Savage</title>
<link rel="stylesheet" href="/style.css">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
</head>
<body class="login-body">
<div class="grain"></div>
<div class="login-container">
    <div class="login-card error-card">
        <div class="login-header">
            <div class="error-icon">⚠</div>
            <h1 class="error-title">ACCÈS<br>REFUSÉ</h1>
            <div class="divider"></div>
        </div>
        <div class="login-content">
            <p class="error-message">${msg}</p>
            <a href="/" class="btn-back">← Retour</a>
        </div>
    </div>
</div>
</body></html>`;

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

            const hasPermission = state.CONFIG.ROLES.COMMAND_ROLES.some(r => member.roles.cache.has(r));
            if (!hasPermission) return res.send(errorPage('Tu n\'as pas les permissions pour accéder au dashboard'));

            req.session.user = {
                id: user.id,
                username: member.nickname || user.username,
                avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
                roles: [...member.roles.cache.keys()],
            };

            res.redirect('/dashboard');
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
    function requireAuth(req, res, next) {
        if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
        next();
    }

    // ==========================================
    // Routes pages
    // ==========================================
    app.get('/', (req, res) => {
        if (req.session.user) return res.redirect('/dashboard');
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.get('/dashboard', (req, res) => {
        if (!req.session.user) return res.redirect('/');
        res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    });

    // ==========================================
    // API
    // ==========================================
    app.get('/api/me', requireAuth, (req, res) => {
        res.json(req.session.user);
    });

    // Données présence en temps réel
    app.get('/api/presence', requireAuth, async (req, res) => {
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
    app.get('/api/weekly', requireAuth, async (req, res) => {
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
    app.post('/api/command', requireAuth, async (req, res) => {
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
                    const { roleId, message } = params || {};
                    if (!roleId || !message) return res.status(400).json({ error: 'roleId et message requis' });
                    await bmChannel.send({
                        content: `${message.replace(/\\n/g, '\n')}\n\n||<@&${roleId}>||`,
                        allowedMentions: { parse: ['roles'] }
                    });
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
            const channel = botClient.channels.cache.get(state.CONFIG.CHANNELS.AVERTISSEMENT);
            if (!channel) return res.json({ sanctions: [] });

            const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
            const messages = await channel.messages.fetch({ limit: 50 });

            const sanctions = await Promise.all([...messages.values()]
                .filter(m => m.author.bot)
                .map(async m => {
                    let content = m.content;

                    // 1. Résoudre <@&roleId> → @nomDuRole (avec data pour stylisation)
                    content = content.replace(/<@&(\d+)>/g, (match, id) => {
                        const role = guild?.roles.cache.get(id);
                        return role ? `@@ROLE@${role.name}@@` : match;
                    });

                    // 2. Résoudre <@!?userId> → @username (avec data pour stylisation)
                    const userMentions = [...content.matchAll(/<@!?(\d+)>/g)];
                    const mentionedUsers = []; // Pour avoir les avatars
                    for (const um of userMentions) {
                        const userId = um[1];
                        try {
                            const member = await guild?.members.fetch(userId).catch(() => null);
                            if (member) {
                                const name = member.nickname || member.user.username;
                                const avatar = member.user.avatar
                                    ? `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png?size=32`
                                    : null;
                                mentionedUsers.push({ id: userId, name, avatar });
                                content = content.replace(um[0], `@@USER@${userId}@${name}@@`);
                            }
                        } catch {}
                    }

                    // 3. Convertir emojis customs <:name:id> → @@EMOJI@id@name@@
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
                    };
                }));

            res.json({ sanctions });
        } catch (e) {
            res.json({ sanctions: [], error: e.message });
        }
    });

    // Reset le suivi d'un membre
    app.post('/api/tracking/reset', requireAuth, (req, res) => {
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
    app.get('/api/stats', requireAuth, async (req, res) => {
        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);

        // Forcer le fetch complet des membres pour avoir les bons counts
        if (guild) {
            try { await guild.members.fetch(); } catch {}
        }

        // Total = membres ayant MEMBRE_1 OU MEMBRE_2
        let totalMembers = 0;
        if (guild) {
            const counted = new Set();
            const role1 = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1);
            const role2 = guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_2);
            if (role1) for (const [id, m] of role1.members) if (!m.user.bot) counted.add(id);
            if (role2) for (const [id, m] of role2.members) if (!m.user.bot) counted.add(id);
            totalMembers = counted.size;
        }

        const role = guild ? guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1) : null;
        const inscritsOP = role ? role.members.filter(m => !m.user.bot).size : 0;

        const tracking = [...state.absenceTracking.values()];
        const totalUnjustified = tracking.reduce((sum, t) => sum + t.count, 0);
        const withConsecutive = tracking.filter(t => state.getConsecutiveDays(t) >= 2).length;

        res.json({
            totalMembers,
            inscritsOP,
            totalUnjustified,
            membersWithAbsences: tracking.length,
            membersWithConsecutive: withConsecutive,
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
            const categories = [];
            const orphans = [];

            // Collecter les catégories
            for (const [, ch] of channels) {
                if (ch.type === 4) { // CategoryChannel
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

            res.json({ categories, orphans, guildId: state.CONFIG.GUILD_ID });
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

        try {
            const channel = botClient.channels.cache.get(channelId);
            if (!channel) return res.status(404).json({ error: 'Salon introuvable' });

            // Forums : on retourne les threads à la place des messages
            if (channel.type === 15) {
                const activeThreads = await channel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                const archivedThreads = await channel.threads.fetchArchived({ limit: 50 }).catch(() => ({ threads: new Map() }));

                const allThreads = [
                    ...[...activeThreads.threads.values()].map(t => ({ ...t, archived: false })),
                    ...[...archivedThreads.threads.values()].map(t => ({ ...t, archived: true })),
                ];

                const threads = await Promise.all(allThreads.map(async t => {
                    let firstMessage = null;
                    try {
                        const messages = await t.messages.fetch({ limit: 1, after: '0' }).catch(() => null);
                        if (messages && messages.size > 0) {
                            firstMessage = messages.first();
                        }
                    } catch {}

                    return {
                        id: t.id,
                        name: t.name,
                        archived: t.archived,
                        messageCount: t.messageCount,
                        memberCount: t.memberCount,
                        createdTimestamp: t.createdTimestamp,
                        firstMessage: firstMessage ? {
                            content: firstMessage.content,
                            authorName: firstMessage.member?.nickname || firstMessage.author.username,
                            authorAvatar: firstMessage.author.avatar
                                ? `https://cdn.discordapp.com/avatars/${firstMessage.author.id}/${firstMessage.author.avatar}.png?size=64`
                                : null,
                            attachments: [...firstMessage.attachments.values()].map(a => ({
                                url: a.url,
                                name: a.name,
                                isImage: a.contentType?.startsWith('image/') || false,
                            })),
                        } : null,
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

            const guild = botClient.guilds.cache.get(botState().CONFIG.GUILD_ID);
            const messages = await channel.messages.fetch(fetchOptions);

            const result = await Promise.all([...messages.values()].map(async m => {
                // Construire la liste des mentions avec noms RÉSOLUS
                const userMentions = await Promise.all([...m.mentions.users.values()].map(async u => {
                    const member = await guild?.members.fetch(u.id).catch(() => null);
                    return {
                        id: u.id,
                        name: member?.nickname || u.username,
                    };
                }));

                return {
                    id: m.id,
                    content: m.content,
                    authorId: m.author.id,
                    authorName: m.member?.nickname || m.author.username,
                    authorAvatar: m.author.avatar
                        ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64`
                        : null,
                    authorBot: m.author.bot,
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
            const channel = botClient.channels.cache.get(channelId);
            if (!channel) return res.status(404).json({ error: 'Salon introuvable' });

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
                    parse: ['users', 'roles'],
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

    app.get('/api/channel/:id/pinned', requireAuth, async (req, res) => {
        try {
            const channel = botClient.channels.cache.get(req.params.id);
            if (!channel) return res.status(404).json({ error: 'Salon introuvable' });

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
            .filter(r => r.name !== '@everyone' && !r.managed)
            .sort((a, b) => b.position - a.position)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
                position: r.position,
                memberCount: r.members.size,
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
    const fs = require('fs');
    const MAP_POINTS_FILE = '/data/map_points.json';

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
        const userRoles = req.session.user?.roles || [];
        const allPoints = loadMapPoints();

        // Filtrer : si le point a allowedRoles, l'user doit avoir au moins un de ces rôles
        const visiblePoints = allPoints.filter(p => {
            if (!p.allowedRoles || p.allowedRoles.length === 0) return true; // Public
            return p.allowedRoles.some(r => userRoles.includes(r));
        });

        res.json({ points: visiblePoints });
    });

    // Vérifier permissions de placer des points (mêmes que COMMAND_ROLES par défaut)
    function canEditMap(req) {
        const state = botState();
        const userRoles = req.session.user?.roles || [];
        return state.CONFIG.ROLES.COMMAND_ROLES.some(r => userRoles.includes(r));
    }

    app.post('/api/map/points', requireAuth, (req, res) => {
        if (!canEditMap(req)) return res.status(403).json({ error: 'Permissions insuffisantes pour modifier la carte' });

        const { x, y, label, type, allowedRoles, code } = req.body;
        if (typeof x !== 'number' || typeof y !== 'number') {
            return res.status(400).json({ error: 'Coordonnées invalides' });
        }

        const points = loadMapPoints();
        const point = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            x, y,
            label: label || 'Point',
            type: type || 'weed',
            // Code uniquement pour les types qui en ont besoin
            code: ['lab', 'weapon-lab'].includes(type) ? (code || '').trim().slice(0, 50) : null,
            allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [],
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
        });
    });

    app.listen(PORT, () => {
        console.log(`🌐 Dashboard web démarré sur le port ${PORT}`);
    });
}

module.exports = { startServer };
