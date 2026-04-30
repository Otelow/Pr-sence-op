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

        try {
            // Échanger le code contre un token
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

            // Récupérer les infos user
            const userRes = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
            });

            const user = userRes.data;

            // Vérifier que l'user est dans le serveur ET a un rôle autorisé
            const state = botState();
            const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
            if (!guild) return res.send('❌ Bot non connecté au serveur');

            const member = await guild.members.fetch(user.id).catch(() => null);
            if (!member) return res.send('❌ Tu n\'es pas membre du serveur Discord');

            const hasPermission = state.CONFIG.ROLES.COMMAND_ROLES.some(r => member.roles.cache.has(r));
            if (!hasPermission) return res.send('❌ Tu n\'as pas les permissions pour accéder au dashboard');

            req.session.user = {
                id: user.id,
                username: member.nickname || user.username,
                avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
            };

            res.redirect('/dashboard');
        } catch (e) {
            console.error('❌ OAuth erreur:', e.message);
            res.send('❌ Erreur de connexion. Vérifie la console.');
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
                const m = { id: member.id, name, avatar: member.user.avatar ? `https://cdn.discordapp.com/avatars/${member.id}/${member.user.avatar}.png` : null };
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
    app.get('/api/weekly', requireAuth, (req, res) => {
        const state = botState();
        const tracking = [...state.absenceTracking.entries()].map(([id, data]) => ({
            id,
            username: data.username,
            count: data.count,
            details: data.details || [],
            consecutiveDays: state.getConsecutiveDays(data),
        })).sort((a, b) => b.count - a.count);

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

            const messages = await channel.messages.fetch({ limit: 50 });
            const sanctions = [...messages.values()]
                .filter(m => m.author.bot)
                .map(m => ({
                    id: m.id,
                    content: m.content,
                    createdAt: m.createdAt,
                    timestamp: m.createdTimestamp,
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
    app.get('/api/stats', requireAuth, (req, res) => {
        const state = botState();
        const guild = botClient.guilds.cache.get(state.CONFIG.GUILD_ID);
        const role = guild ? guild.roles.cache.get(state.CONFIG.ROLES.MEMBRE_1) : null;
        const totalMembers = role ? role.members.filter(m => !m.user.bot).size : 0;

        const tracking = [...state.absenceTracking.values()];
        const totalUnjustified = tracking.reduce((sum, t) => sum + t.count, 0);
        const withConsecutive = tracking.filter(t => state.getConsecutiveDays(t) >= 2).length;

        res.json({
            totalMembers,
            totalUnjustified,
            membersWithAbsences: tracking.length,
            membersWithConsecutive: withConsecutive,
            op1Active: state.presenceData.active,
            op2Active: state.presence2Data.active,
        });
    });

    app.listen(PORT, () => {
        console.log(`🌐 Dashboard web démarré sur le port ${PORT}`);
    });
}

module.exports = { startServer };
