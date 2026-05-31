// STABILISATION 15/05/2026 — corrections runtime post-audit
// MODIFIÉ CHANTIER 6 — 14/05/2026 — service accueil Discord externalisé

function createWelcomeService(deps) {
    const {
        CONFIG,
        client,
        welcomeState,
        renameCheckState,
        welcomeKickDelay,
        renameKickDelay,
        safeReact,
        sleep,
        saveWelcomeState,
        deleteWelcomeState,
        saveRenameCheckState,
        deleteRenameCheckState,
    } = deps;

    function clearRenameCheck(userId) {
        renameCheckState.delete(userId);
        deleteRenameCheckState?.(userId);
    }

    async function startWelcomeFlow(member) {
        const channel = member.guild.channels.cache.get(CONFIG.CHANNELS.REGLEMENT);

        const oldState = welcomeState.get(member.id);
        if (oldState && oldState.kickTimer) clearTimeout(oldState.kickTimer);

        try {
            await finalizeWelcomeDirectly(member.guild, member, member.id, channel);
        } catch {}
    }

    async function scheduleRenameCheck(userId) {
        const initialState = renameCheckState.get(userId);
        const remainingDelay = initialState?.createdAt
            ? Math.max(0, renameKickDelay - (Date.now() - initialState.createdAt))
            : renameKickDelay;
        setTimeout(async () => {
            const renameState = renameCheckState.get(userId);
            if (!renameState) return;

            try {
                const guild = client.guilds.cache.get(renameState.guildId);
                const member = await guild.members.fetch(userId).catch(() => null);
                if (!member) {
                    clearRenameCheck(userId);
                    return;
                }

                if (member.roles.cache.has(CONFIG.ROLES.EXCLUDED_RENAME)) {
                    clearRenameCheck(userId);
                    return;
                }

                const hasProtected = CONFIG.ROLES.PROTECTED_ROLES.some(roleId => member.roles.cache.has(roleId));
                if (hasProtected) {
                    clearRenameCheck(userId);
                    return;
                }

                if ((member.nickname || member.user.username) === renameState.originalName) {
                    await member.send(`Salut, tu viens d'être Kick du Serveur **21 Block Savage** ${CONFIG.EMOJIS.BS21} car tu ne t'es pas renommé.\nA bientôt ! ${CONFIG.EMOJIS.BS21}`).catch(() => {});
                    await member.kick('Pas renommé').catch(() => {});
                }
                clearRenameCheck(userId);
            } catch {
                clearRenameCheck(userId);
            }
        }, remainingDelay);
    }

    function restoreRenameChecks() {
        for (const userId of renameCheckState.keys()) {
            scheduleRenameCheck(userId);
        }
    }

    async function finalizeWelcome(guild, member, userId, channel) {
        const welcomeMsg = await channel.send(`${member} Très bien, bienvenu à toi jeune **21 Block Savage** ! Pense à te renommer dans les 10 minutes ! ${CONFIG.EMOJIS.BS21}`);

        try {
            const freshMember = await guild.members.fetch(userId);
            for (const roleId of [CONFIG.ROLES.MEMBRE_1, CONFIG.ROLES.MEMBRE_2, CONFIG.ROLES.MEMBRE_3]) {
                const role = guild.roles.cache.get(roleId);
                if (role) await freshMember.roles.add(role);
            }

            const originalName = freshMember.nickname || freshMember.user.username;
            const renameState = { originalName, guildId: guild.id, createdAt: Date.now() };
            renameCheckState.set(userId, renameState);
            saveRenameCheckState?.(userId, renameState);
            await scheduleRenameCheck(userId);
        } catch {}

        deleteWelcomeState(userId);
        setTimeout(() => welcomeMsg.delete().catch(() => {}), 30_000);
    }

    async function finalizeWelcomeDirectly(guild, member, userId, channel) {
        const message = `${member} Bienvenue chez les **21 Block Savage** ! Tes roles viennent d'etre attribues directement. Pense a te renommer dans les 10 minutes ! ${CONFIG.EMOJIS.BS21}`;
        const welcomeMsg = channel ? await channel.send(message).catch(() => null) : null;

        try {
            const freshMember = await guild.members.fetch(userId);
            for (const roleId of [CONFIG.ROLES.MEMBRE_1, CONFIG.ROLES.MEMBRE_2, CONFIG.ROLES.MEMBRE_3]) {
                const role = guild.roles.cache.get(roleId);
                if (role && !freshMember.roles.cache.has(roleId)) await freshMember.roles.add(role);
            }

            const originalName = freshMember.nickname || freshMember.user.username;
            const renameState = { originalName, guildId: guild.id, createdAt: Date.now() };
            renameCheckState.set(userId, renameState);
            saveRenameCheckState?.(userId, renameState);
            await scheduleRenameCheck(userId);
        } catch {}

        deleteWelcomeState(userId);
        if (welcomeMsg) setTimeout(() => welcomeMsg.delete().catch(() => {}), 30_000);
    }

    async function runWelcomeStep(channel, guild, member, step) {
        const userId = member.id || member.user?.id;

        const messages = {
            1: `Salut à toi ${member} ! 👋\n\nLis bien le règlement et quand cela est fait, clique sur la réaction ${CONFIG.EMOJIS.CHECK}`,
            2: `${member} Tu as bien lu le règlement ? ${CONFIG.EMOJIS.CHECK}`,
            3: `${member} Tu es vraiment sûr ? Tu vas pas être kp au bout d'une heure car tu as pas tout lu ? Si tu as tout lu réagi avec ${CONFIG.EMOJIS.CHECK}`,
            4: `${member} Donc tu as compris que ça va être une tyrannie, tu es toujours sûr de vouloir rejoindre ?`,
        };

        const reactions = {
            1: [CONFIG.REACT_EMOJIS.CHECK, CONFIG.REACT_EMOJIS.NO],
            2: [CONFIG.REACT_EMOJIS.CHECK, CONFIG.REACT_EMOJIS.NO],
            3: [CONFIG.REACT_EMOJIS.CHECK, CONFIG.REACT_EMOJIS.NO],
            4: [CONFIG.REACT_EMOJIS.CHECK, CONFIG.REACT_EMOJIS.BM, CONFIG.REACT_EMOJIS.NO],
        };

        const msg = await channel.send(messages[step]);
        for (const emoji of reactions[step]) await safeReact(msg, emoji);
        welcomeState.set(userId, { step, messageId: msg.id, guildId: guild.id, createdAt: Date.now() });
        saveWelcomeState();

        const filter = (reaction, user) => {
            if (user.bot || user.id !== userId) return false;
            const name = reaction.emoji.name;
            const id = reaction.emoji.id;
            return name === 'check' || id === '1486393925219647519'
                || name === 'no' || id === '1486417914084069507'
                || name === 'bm' || id === '1489337087282118686'
                || name === '✅' || name === '❌';
        };

        const collector = msg.createReactionCollector({ filter, max: 1, time: welcomeKickDelay });

        collector.on('collect', async (reaction) => {
            const isNo = reaction.emoji.name === 'no'
                || reaction.emoji.id === '1486417914084069507'
                || reaction.emoji.name === '❌';
            await msg.delete().catch(() => {});

            if (isNo) {
                try {
                    const freshMember = await guild.members.fetch(userId);
                    await freshMember.kick('Refusé');
                } catch {}
                deleteWelcomeState(userId);
                return;
            }

            if (step < 4) return runWelcomeStep(channel, guild, member, step + 1);
            return finalizeWelcome(guild, member, userId, channel);
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                msg.delete().catch(() => {});
                guild.members.fetch(userId).then(memberToKick => {
                    const hasProtected = CONFIG.ROLES.PROTECTED_ROLES.some(roleId => memberToKick.roles.cache.has(roleId));
                    if (!hasProtected) memberToKick.kick('Timeout').catch(() => {});
                }).catch(() => {});
                deleteWelcomeState(userId);
            }
        });
    }

    async function handleWelcomeReactionFallback(reaction, user, state) {
        const userId = user.id;
        const isCheck = reaction.emoji.name === 'check' || reaction.emoji.id === '1486393925219647519' || reaction.emoji.name === '✅';
        const isNo = reaction.emoji.name === 'no' || reaction.emoji.id === '1486417914084069507' || reaction.emoji.name === '❌';
        const isBM = reaction.emoji.name === 'bm' || reaction.emoji.id === '1489337087282118686';

        if (!isCheck && !isNo && !isBM) return;

        const guild = client.guilds.cache.get(state.guildId || CONFIG.GUILD_ID);
        if (!guild) return;
        const channel = guild.channels.cache.get(CONFIG.CHANNELS.REGLEMENT);
        if (!channel) return;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        try {
            const oldMsg = await channel.messages.fetch(state.messageId).catch(() => null);
            if (oldMsg) await oldMsg.delete().catch(() => {});
        } catch {}

        if (isNo) {
            try { await member.kick('Refusé'); } catch {}
            deleteWelcomeState(userId);
            return;
        }

        await finalizeWelcomeDirectly(guild, member, userId, channel);
    }

    return {
        startWelcomeFlow,
        restoreRenameChecks,
        runWelcomeStep,
        handleWelcomeReactionFallback,
    };
}

module.exports = {
    createWelcomeService,
};
