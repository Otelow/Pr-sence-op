// MODIFIÉ CHANTIER 6 — 14/05/2026 — commandes utilitaires slash isolées

function createUtilityCommandHandlers(deps) {
    const {
        CONFIG,
        TIMERS,
        client,
        sleep,
        setLastRadioMessageId,
    } = deps;

    async function handleSimpleAlert(interaction, message, mentionRoles = false) {
        await interaction.reply({ content: '🚨 Envoi...', ephemeral: true });
        const channel = client.channels.cache.get(CONFIG.CHANNELS.QG);
        if (!channel) return interaction.editReply('❌ Salon QG introuvable');

        const sent = [];
        const opts = mentionRoles ? { content: message, allowedMentions: { parse: ['roles'] } } : message;

        for (let i = 0; i < 15; i++) {
            sent.push(await channel.send(opts));
            await sleep(TIMERS.QG_MESSAGE_INTERVAL);
        }

        await interaction.editReply(`✅ ${sent.length} alertes envoyées`);
        setTimeout(async () => {
            for (const msg of sent) {
                await msg.delete().catch(() => {});
                await sleep(300);
            }
        }, TIMERS.QG_DELETE_DELAY);
    }

    async function handleRadio(interaction) {
        const channel = client.channels.cache.get(CONFIG.CHANNELS.RADIO);
        if (!channel) {
            try { await interaction.reply({ content: '❌ Salon radio introuvable', ephemeral: true }); } catch {}
            return;
        }

        const freq = `${String(Math.floor(Math.random() * 98) + 1).padStart(2, '0')}.${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;

        try {
            await interaction.reply({ content: `✅ Radio : **${freq}**`, ephemeral: true });
        } catch (e) {
            console.error('❌ /radio reply erreur:', e.message);
            return;
        }

        (async () => {
            try {
                const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
                if (messages) {
                    const oldRadios = messages.filter(msg =>
                        msg.author.id === client.user.id &&
                        msg.content.includes('Voici la nouvelle Radio')
                    );
                    for (const [, msg] of oldRadios) {
                        await msg.delete().catch(() => {});
                        await sleep(200);
                    }
                    if (oldRadios.size > 0) {
                        console.log(`🗑️ ${oldRadios.size} ancienne(s) radio(s) supprimée(s)`);
                    }
                }
            } catch (e) {
                console.error('❌ Cleanup radios:', e.message);
            }

            try {
                const msg = await channel.send({
                    content: `Voici la nouvelle Radio <@&${CONFIG.ROLES.MEMBRE_1}> : **${freq}**\nMerci de vous connecter dessus ! ${CONFIG.EMOJIS.BS21}`,
                    allowedMentions: { parse: ['roles'] },
                });
                setLastRadioMessageId(msg.id);
            } catch (e) {
                console.error('❌ /radio envoi erreur:', e.message);
            }
        })();
    }

    async function handleAnnonce(interaction) {
        const role = interaction.options.getRole('role');
        const msg = interaction.options.getString('message').replace(/\\n/g, '\n');
        const channel = client.channels.cache.get(CONFIG.CHANNELS.BM_NOTIF);
        if (!channel) return interaction.reply({ content: '❌ Salon introuvable', ephemeral: true });

        await channel.send({ content: `${msg}\n\n||<@&${role.id}>||`, allowedMentions: { parse: ['roles'] } });
        await interaction.reply({ content: '✅ Annonce envoyée', ephemeral: true });
    }

    async function clearBotMessages(channel, limit) {
        let deleted = 0;
        const messages = await channel.messages.fetch({ limit: Math.min(limit, 100) });
        const botMessages = messages.filter(msg => msg.author.id === client.user.id);

        if (botMessages.size === 0) return 0;

        const now = Date.now();
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        const recent = [];
        const old = [];
        for (const [, msg] of botMessages) {
            if (now - msg.createdTimestamp < fourteenDays) recent.push(msg);
            else old.push(msg);
        }

        if (recent.length >= 2) {
            try {
                const bulk = await channel.bulkDelete(recent, true);
                deleted += bulk.size;
            } catch (e) {
                console.warn('⚠️ bulkDelete fallback:', e.message);
                for (const msg of recent) {
                    try { await msg.delete(); deleted++; } catch {}
                    await sleep(300);
                }
            }
        } else if (recent.length === 1) {
            try { await recent[0].delete(); deleted++; } catch {}
        }

        for (const msg of old) {
            try { await msg.delete(); deleted++; } catch {}
            await sleep(500);
        }

        return deleted;
    }

    async function handleClear(interaction) {
        try {
            await interaction.reply({ content: '🧹 Suppression en cours...', ephemeral: true });
        } catch (e) {
            console.error('❌ /clear reply:', e.message);
            return;
        }

        const limit = interaction.options.getInteger('nombre') || 100;

        try {
            const count = await clearBotMessages(interaction.channel, limit);
            await interaction.editReply(`🧹 ${count} message(s) du bot supprimé(s)`).catch(() => {});
        } catch (e) {
            console.error('❌ /clear erreur:', e.message);
            await interaction.editReply(`❌ Erreur : ${e.message}`).catch(() => {});
        }
    }

    async function handleClearMessage(interaction) {
        try {
            await interaction.reply({ content: '🧹 Suppression en cours...', ephemeral: true });
        } catch (e) {
            console.error('❌ /clearmessage reply:', e.message);
            return;
        }

        const nombre = interaction.options.getInteger('nombre');

        try {
            const messages = await interaction.channel.messages.fetch({ limit: Math.min(nombre, 100) });
            const toDelete = messages.filter(msg => msg.author.id !== '952986899667103804');

            const now = Date.now();
            const fourteenDays = 14 * 24 * 60 * 60 * 1000;
            const recent = [];
            const old = [];
            for (const [, msg] of toDelete) {
                if (now - msg.createdTimestamp < fourteenDays) recent.push(msg);
                else old.push(msg);
            }

            let deleted = 0;

            if (recent.length >= 2) {
                try {
                    const bulk = await interaction.channel.bulkDelete(recent, true);
                    deleted += bulk.size;
                } catch (e) {
                    console.warn('⚠️ bulkDelete fallback:', e.message);
                    for (const msg of recent) {
                        try { await msg.delete(); deleted++; } catch {}
                        await sleep(300);
                    }
                }
            } else if (recent.length === 1) {
                try { await recent[0].delete(); deleted++; } catch {}
            }

            for (const msg of old) {
                try { await msg.delete(); deleted++; } catch {}
                await sleep(500);
            }

            await interaction.editReply(`🧹 ${deleted} message(s) supprimé(s)${old.length > 0 ? ` (dont ${old.length} > 14 jours)` : ''}`).catch(() => {});
        } catch (e) {
            console.error('❌ /clearmessage erreur:', e.message);
            await interaction.editReply(`❌ Erreur : ${e.message}`).catch(() => {});
        }
    }

    return {
        handleSimpleAlert,
        handleRadio,
        handleAnnonce,
        handleClear,
        handleClearMessage,
    };
}

module.exports = {
    createUtilityCommandHandlers,
};
