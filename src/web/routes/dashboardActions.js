// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes actions dashboard et sanctions isolées

const { EmbedBuilder } = require('discord.js');

function memberAvatarUrl(userId, avatar, size = 32) {
    return avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=${size}` : null;
}

async function sendRepeatedAlert(channel, content) {
    const sent = [];
    for (let i = 0; i < 15; i++) {
        const message = await channel.send({ content, allowedMentions: { parse: ['roles'] } });
        sent.push(message);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    setTimeout(() => {
        for (const message of sent) message.delete().catch(() => {});
    }, 120_000);
    return sent.length;
}

function buildAlertMessages(state) {
    return {
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
}

async function sendRoleAnnouncement(channel, params, color, options = {}) {
    const { roleId, message, useEmbed } = params || {};
    if (!roleId || !message) return { error: 'roleId et message requis', status: 400 };

    if (useEmbed) {
        if (message.length > 4000) return { error: 'Message trop long (max 4000)', status: 400 };
        const embed = new EmbedBuilder()
            .setDescription(message.replace(/\\n/g, '\n'))
            .setColor(color)
            .setTimestamp();
        await channel.send({
            content: `||<@&${roleId}>||`,
            embeds: [embed],
            allowedMentions: { parse: ['roles'] },
        });
    } else {
        if (message.length > 2000) return { error: 'Message trop long (max 2000)', status: 400 };
        await channel.send({
            content: `${message.replace(/\\n/g, '\n')}\n\n||<@&${roleId}>||`,
            allowedMentions: { parse: ['roles'] },
        });
    }

    return { success: true };
}

function registerDashboardActionRoutes(app, deps) {
    const {
        commandLimiter,
        requireAuth,
        requireFullSiteAccess,
        getBotClient,
        getBotState,
        emitRealtime,
    } = deps;

    app.post('/api/command', commandLimiter, requireAuth, requireFullSiteAccess, async (req, res) => {
        const { command, params } = req.body;
        const state = getBotState();
        const client = getBotClient();

        try {
            const qgChannel = client.channels.cache.get(state.CONFIG.CHANNELS.QG);
            const radioChannel = client.channels.cache.get(state.CONFIG.CHANNELS.RADIO);
            const bmChannel = client.channels.cache.get(state.CONFIG.CHANNELS.BM_NOTIF);

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
                    if (!qgChannel) return res.status(500).json({ error: 'Salon QG introuvable' });
                    const sent = await sendRepeatedAlert(qgChannel, buildAlertMessages(state)[command]);
                    return res.json({ success: true, sent });
                }

                case 'radio': {
                    if (!radioChannel) return res.status(500).json({ error: 'Salon radio introuvable' });
                    const freq = `${String(Math.floor(Math.random() * 98) + 1).padStart(2, '0')}.${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
                    await radioChannel.send({
                        content: `Voici la nouvelle Radio <@&${state.CONFIG.ROLES.MEMBRE_1}> : **${freq}**\nMerci de vous connecter dessus ! ${state.CONFIG.EMOJIS.BS21}`,
                        allowedMentions: { parse: ['roles'] },
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
                    const result = await sendRoleAnnouncement(bmChannel, params, 0xff8c00);
                    if (result.error) return res.status(result.status).json({ error: result.error });
                    return res.json({ success: true });
                }

                case 'rappel': {
                    const rappelChannel = client.channels.cache.get(state.CONFIG.CHANNELS.RAPPELS_PANEL);
                    if (!rappelChannel) return res.status(500).json({ error: 'Salon rappels introuvable' });
                    const result = await sendRoleAnnouncement(rappelChannel, params, 0x5865f2);
                    if (result.error) return res.status(result.status).json({ error: result.error });
                    return res.json({ success: true });
                }

                case 'sanction': {
                    const sanctionChannel = client.channels.cache.get(state.CONFIG.CHANNELS.SANCTION);
                    if (!sanctionChannel) return res.status(500).json({ error: 'Salon sanction introuvable' });
                    const { userId, raison } = params || {};
                    if (!userId || !raison) return res.status(400).json({ error: 'userId et raison requis' });

                    const cleanId = userId.replace(/[<@!>]/g, '').trim();
                    const mention = /^\d{17,20}$/.test(cleanId) ? `<@${cleanId}>` : userId;
                    const attentionEmoji = state.CONFIG.EMOJIS?.ATTENTION || '⚠️';
                    const bs21Emoji = state.CONFIG.EMOJIS?.BS21 || '';

                    await sanctionChannel.send(`${mention} Vous avez reçu un **avertissement** pour la raison suivante : ${raison} ${attentionEmoji} ${bs21Emoji}`);
                    emitRealtime('sanction:added', { userId: cleanId, raison });
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

    app.get('/api/sanctions', requireAuth, requireFullSiteAccess, async (req, res) => {
        const state = getBotState();
        const client = getBotClient();
        try {
            const guild = client.guilds.cache.get(state.CONFIG.GUILD_ID);
            const channelIds = [
                state.CONFIG.CHANNELS.AVERTISSEMENT,
                state.CONFIG.CHANNELS.SANCTION,
            ].filter(Boolean);
            const seen = new Set();
            const allMessages = [];
            for (const channelId of channelIds) {
                if (seen.has(channelId)) continue;
                seen.add(channelId);
                const channel = client.channels.cache.get(channelId);
                if (!channel) continue;
                const messages = await channel.messages.fetch({ limit: 100 });
                allMessages.push(...messages.values());
            }

            const sanctions = await Promise.all(allMessages
                .filter(message => message.author.bot)
                .map(async message => {
                    let content = message.content;

                    content = content.replace(/<@&(\d+)>/g, (match, id) => {
                        const role = guild?.roles.cache.get(id);
                        if (!role) return match;
                        const color = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '';
                        return `@@ROLE@${role.name}@${color}@@`;
                    });

                    const userMatches = [...content.matchAll(/<@!?(\d+)>/g)];
                    const mentionedUsers = [];
                    for (const userMatch of userMatches) {
                        const userId = userMatch[1];
                        try {
                            const member = await guild?.members.fetch(userId).catch(() => null);
                            if (member) {
                                const name = member.nickname || member.user.username;
                                const avatar = memberAvatarUrl(userId, member.user.avatar);
                                const color = member.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : '';
                                mentionedUsers.push({ id: userId, name, avatar, color });
                                content = content.replace(userMatch[0], `@@USER@${userId}@${name}@${color}@@`);
                            }
                        } catch {}
                    }

                    content = content.replace(/<(a?):(\w+):(\d+)>/g, (match, animated, name, id) => {
                        return `@@EMOJI@${id}@${name}@${animated ? 'a' : ''}@@`;
                    });

                    return {
                        id: message.id,
                        content,
                        rawContent: message.content,
                        mentionedUsers,
                        createdAt: message.createdAt,
                        timestamp: message.createdTimestamp,
                        channelId: message.channelId,
                    };
                }));
            sanctions.sort((a, b) => b.timestamp - a.timestamp);

            res.json({ sanctions });
        } catch (e) {
            res.json({ sanctions: [], error: e.message });
        }
    });
}

module.exports = {
    registerDashboardActionRoutes,
};
