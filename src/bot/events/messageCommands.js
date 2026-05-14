// MODIFIÉ CHANTIER 6 — 14/05/2026 — messageCreate BM/!presence isolé
function registerMessageCommandEvents(client, context) {
    const {
        CONFIG,
        getCustomPresenceMessage,
        setCustomPresenceMessage,
    } = context;

    client.on('messageCreate', async message => {
        if (message.author.id === client.user.id && message.channelId === CONFIG.CHANNELS.BM_NOTIF) return;

        if (message.channelId === CONFIG.CHANNELS.BM_ANNONCES) {
            const ch = client.channels.cache.get(CONFIG.CHANNELS.BM_NOTIF);
            if (!ch) return;
            try {
                await ch.send({
                    content: `Une annonce du Black Market ${CONFIG.EMOJIS.BM} vient d'être postée <#${CONFIG.CHANNELS.BM_ANNONCES}>. Merci de réagir au message et d'appliquer les actions demandées si nécessaire.\nPour rappel, aucune réaction troll n'est tolérée. Seuls les hauts gradés sont autorisés à répondre ${CONFIG.EMOJIS.ATTENTION}\n\n||<@&${CONFIG.ROLES.MEMBRE_1}>||`,
                    allowedMentions: { parse: ['roles'] },
                });
            } catch {}
            return;
        }

        if (message.channelId === CONFIG.CHANNELS.COMMANDES && message.content.startsWith('!presence')) {
            if (message.author.bot) return;
            if (!CONFIG.ROLES.COMMAND_ROLES.some(r => message.member.roles.cache.has(r))) return;

            const content = message.content.replace(/^!presence\s*/, '').trim();
            if (!content) {
                const reply = await message.reply(`📋 **Message actuel :**\n\n${getCustomPresenceMessage() || '*(Défaut)*'}\n\n\`!presence reset\` pour réinitialiser.`);
                await message.delete().catch(() => {});
                setTimeout(() => reply.delete().catch(() => {}), 30_000);
                return;
            }
            if (content.toLowerCase() === 'reset') {
                setCustomPresenceMessage(null);
                const reply = await message.reply('✅ Réinitialisé.');
                await message.delete().catch(() => {});
                setTimeout(() => reply.delete().catch(() => {}), 10_000);
                return;
            }
            setCustomPresenceMessage(content);
            const reply = await message.reply('✅ Message mis à jour !');
            await message.delete().catch(() => {});
            setTimeout(() => reply.delete().catch(() => {}), 30_000);
        }
    });
}

module.exports = { registerMessageCommandEvents };
