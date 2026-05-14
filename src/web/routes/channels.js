// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes salons Discord isolées

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

function discordAvatarUrl(userId, avatar, size = 64) {
    return avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=${size}` : null;
}

function formatAttachment(attachment) {
    return {
        url: attachment.url,
        name: attachment.name,
        size: attachment.size,
        contentType: attachment.contentType,
        isImage: attachment.contentType?.startsWith('image/') || false,
        isVideo: attachment.contentType?.startsWith('video/') || false,
    };
}

function formatEmbed(embed) {
    return {
        title: embed.title,
        description: embed.description,
        url: embed.url,
        color: embed.color,
        image: embed.image?.url,
        thumbnail: embed.thumbnail?.url,
        fields: embed.fields,
        video: embed.video?.url,
    };
}

async function buildForumThread(thread) {
    let firstMessage = null;
    try {
        const starterMsg = await thread.fetchStarterMessage().catch(() => null);
        if (starterMsg) {
            firstMessage = starterMsg;
        } else {
            const messages = await thread.messages.fetch({ limit: 1 }).catch(() => null);
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
            authorAvatar: discordAvatarUrl(firstMessage.author.id, firstMessage.author.avatar),
            attachments: [...firstMessage.attachments.values()].map(formatAttachment),
            embeds: firstMessage.embeds.map(formatEmbed),
        };
    }

    return {
        id: thread.id,
        name: thread.name,
        archived: thread.archived,
        messageCount: thread.messageCount,
        memberCount: thread.memberCount,
        createdTimestamp: thread.createdTimestamp,
        firstMessage: firstMessageData,
    };
}

async function formatDiscordMessage(message, guild) {
    const userMentions = await Promise.all([...message.mentions.users.values()].map(async user => {
        const member = await guild?.members.fetch(user.id).catch(() => null);
        const displayColor = member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null;
        return {
            id: user.id,
            name: member?.nickname || user.username,
            color: displayColor,
        };
    }));

    const authorMember = message.member;
    const authorColor = authorMember?.displayHexColor && authorMember.displayHexColor !== '#000000' ? authorMember.displayHexColor : null;

    return {
        id: message.id,
        content: message.content,
        authorId: message.author.id,
        authorName: message.member?.nickname || message.author.username,
        authorAvatar: discordAvatarUrl(message.author.id, message.author.avatar),
        authorBot: message.author.bot,
        authorColor,
        createdTimestamp: message.createdTimestamp,
        editedTimestamp: message.editedTimestamp,
        attachments: [...message.attachments.values()].map(formatAttachment),
        embeds: message.embeds.map(formatEmbed),
        pinned: message.pinned,
        mentions: {
            users: userMentions,
            roles: [...message.mentions.roles.values()].map(role => ({ id: role.id, name: role.name, color: role.color })),
        },
        reactions: [...message.reactions.cache.values()].map(reaction => ({
            emoji: reaction.emoji.id ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name,
            emojiUrl: reaction.emoji.id ? `https://cdn.discordapp.com/emojis/${reaction.emoji.id}.${reaction.emoji.animated ? 'gif' : 'png'}` : null,
            emojiName: reaction.emoji.name,
            count: reaction.count,
        })),
    };
}

function registerChannelRoutes(app, deps) {
    const {
        requireAuth,
        requireFullSiteAccess,
        getBotClient,
        getBotState,
        fetchDiscordChannel,
        userCanViewChannel,
        userCanSendToChannel,
        canRoleViewChannel,
        isUserAdmin,
        hasFullSiteAccess,
    } = deps;

    app.get('/api/channels', requireAuth, requireFullSiteAccess, async (req, res) => {
        const state = getBotState();
        const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
        if (!guild) return res.json({ categories: [] });

        try {
            const channels = guild.channels.cache;
            const impersonateRole = req.query.impersonate;
            const canImpersonate = !!impersonateRole && isUserAdmin(req.session.user);
            const impersonatedRole = canImpersonate ? guild.roles.cache.get(impersonateRole) : null;
            const canSeeChannel = (channel) => {
                if (canImpersonate) return canRoleViewChannel(channel, impersonatedRole);
                return userCanViewChannel(channel, req.session.user);
            };
            const categories = [];
            const orphans = [];

            for (const [, channel] of channels) {
                if (channel.type === 4) {
                    if (!canSeeChannel(channel)) continue;
                    categories.push({
                        id: channel.id,
                        name: channel.name,
                        position: channel.position,
                        channels: [],
                    });
                }
            }

            categories.sort((a, b) => a.position - b.position);

            for (const [, channel] of channels) {
                if (channel.type === 4) continue;
                if (!canSeeChannel(channel)) continue;

                const channelData = {
                    id: channel.id,
                    name: channel.name,
                    type: channel.type,
                    typeLabel: getChannelTypeLabel(channel.type),
                    position: channel.position,
                    topic: channel.topic || null,
                    nsfw: channel.nsfw || false,
                    url: `https://discord.com/channels/${state.CONFIG.GUILD_ID}/${channel.id}`,
                };

                if (channel.parentId) {
                    const category = categories.find(item => item.id === channel.parentId);
                    if (category) category.channels.push(channelData);
                } else {
                    orphans.push(channelData);
                }
            }

            for (const category of categories) {
                category.channels.sort((a, b) => a.position - b.position);
            }
            orphans.sort((a, b) => a.position - b.position);

            res.json({
                categories: categories.filter(category => category.channels.length > 0 || canSeeChannel(channels.get(category.id))),
                orphans,
                guildId: state.CONFIG.GUILD_ID,
            });
        } catch (e) {
            res.json({ error: e.message, categories: [] });
        }
    });

    app.get('/api/channel/:id/messages', requireAuth, requireFullSiteAccess, async (req, res) => {
        const channelId = req.params.id;
        const before = req.query.before;
        const after = req.query.after;

        try {
            const channel = await fetchDiscordChannel(channelId);
            if (!channel) return res.status(404).json({ error: 'Salon introuvable' });
            if (!userCanViewChannel(channel, req.session.user)) {
                return res.status(403).json({ error: 'Acces au salon refuse' });
            }

            if (channel.type === 15) {
                const activeThreads = await channel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                const archivedThreads = await channel.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));

                const allThreads = [
                    ...[...activeThreads.threads.values()],
                    ...[...archivedThreads.threads.values()],
                ];
                const threads = await Promise.all(allThreads.map(buildForumThread));

                return res.json({
                    type: 'forum',
                    threads: threads.sort((a, b) => b.createdTimestamp - a.createdTimestamp),
                    channelName: channel.name,
                });
            }

            if (channel.type !== 0 && channel.type !== 5 && channel.type !== 11 && channel.type !== 12) {
                return res.status(400).json({ error: 'Ce type de salon ne supporte pas les messages' });
            }

            const fetchOptions = { limit: 100 };
            if (before) fetchOptions.before = before;
            if (after && after !== '0') fetchOptions.after = after;

            const state = getBotState();
            const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
            const messages = await channel.messages.fetch(fetchOptions);
            const result = await Promise.all([...messages.values()].map(message => formatDiscordMessage(message, guild)));

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

    app.post('/api/channel/:id/send', requireAuth, requireFullSiteAccess, async (req, res) => {
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

            const isThread = [10, 11, 12].includes(channel.type);
            if (![0, 5].includes(channel.type) && !isThread) {
                return res.status(400).json({ error: 'Ce salon ne supporte pas l\'envoi de messages' });
            }

            const webhookChannel = isThread ? channel.parent : channel;
            if (!webhookChannel) return res.status(400).json({ error: 'Salon parent introuvable' });

            let webhook;
            try {
                const webhooks = await webhookChannel.fetchWebhooks();
                webhook = webhooks.find(item => item.name === '21BS Web Dashboard');
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

    app.get('/api/channel/:id/pinned', requireAuth, requireFullSiteAccess, async (req, res) => {
        try {
            const channel = await fetchDiscordChannel(req.params.id);
            if (!channel) return res.status(404).json({ error: 'Salon introuvable' });
            if (!userCanViewChannel(channel, req.session.user)) {
                return res.status(403).json({ error: 'Acces au salon refuse' });
            }

            const pinned = await channel.messages.fetchPinned();
            const result = [...pinned.values()].map(message => ({
                id: message.id,
                content: message.content,
                authorName: message.member?.nickname || message.author.username,
                authorAvatar: discordAvatarUrl(message.author.id, message.author.avatar, 32),
                createdTimestamp: message.createdTimestamp,
            }));
            res.json({ pinned: result });
        } catch (e) {
            res.json({ pinned: [], error: e.message });
        }
    });
}

module.exports = {
    registerChannelRoutes,
};
