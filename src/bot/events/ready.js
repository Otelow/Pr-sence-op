// STABILISATION 15/05/2026 — corrections runtime post-audit
// MODIFIE CHANTIER 6 - 14/05/2026 - event ready externalise

function registerReadyEvent(deps) {
    const {
        client,
        CONFIG,
        cron,
        TURBO_MODE,
        registerCommands,
        setupPresenceCron,
        scheduleDailyBackups,
        restoreAbsencePanelState,
        restoreRenameChecks,
        loadReminders,
        restorePanelState,
        hasEnabledReminders,
        startReminderLoop,
        updateAbsenceSalonCache,
        loadPresenceState,
        restoreReactionsFromMessage,
        reactionsOP1,
        reactionsOP2,
        presenceData,
        presence2Data,
        savePresenceState,
        startPresenceReminders,
        absenceTracking,
        saveAbsenceTracking,
        sendPresenceMessage,
    } = deps;

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} connecté | ${client.guilds.cache.size} serveur(s)`);
    await registerCommands();
    setupPresenceCron();
    scheduleDailyBackups();
    restoreAbsencePanelState();

    // Charger les rappels du panel
    loadReminders();
    restorePanelState();
    if (hasEnabledReminders()) {
        startReminderLoop();
        console.log('⏰ Boucle de rappels démarrée');
    }

    // Prefetch membres + absences au boot
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        if (guild) {
            await guild.members.fetch();
            console.log(`👥 ${guild.members.cache.size} membres mis en cache`);

            // Vérifier les auto-rôles
            for (const [userId, roleId] of Object.entries(CONFIG.AUTO_ROLE_USERS)) {
                try {
                    const member = guild.members.cache.get(userId);
                    if (member && !member.roles.cache.has(roleId)) {
                        const role = guild.roles.cache.get(roleId);
                        if (role) {
                            await member.roles.add(role);
                            console.log(`🎯 Auto-rôle restauré pour ${member.user.tag}`);
                        }
                    }
                } catch {}
            }
        }
        await updateAbsenceSalonCache();
        restoreRenameChecks?.();
        console.log('📋 Cache absences salon initialisé');
    } catch (e) {
        console.error('⚠️ Erreur prefetch:', e.message);
    }

    // Restaurer l'état de présence si le bot a été redéployé en cours d'OP
    const savedState = loadPresenceState();
    let op1Restored = false;
    let op2Restored = false;

    if (savedState) {
        if (savedState.op1 && savedState.op1.active && savedState.op1.messageId) {
            console.log('🔄 Restauration 1ère Présence OP depuis fichier...');
            const restored = await restoreReactionsFromMessage(savedState.op1.messageId, reactionsOP1);
            if (restored) {
                presenceData.messageId = savedState.op1.messageId;
                presenceData.active = true;
                op1Restored = true;
                console.log('✅ 1ère Présence OP restaurée');

                // Relancer les rappels et crons
                const channel = client.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
                if (channel) {
                    const msg = await channel.messages.fetch(savedState.op1.messageId).catch(() => null);
                    if (msg) startPresenceReminders(channel, msg);
                }
            } else {
                console.log('⚠️ Message 1ère OP introuvable dans le fichier');
            }
        }

        if (savedState.op2 && savedState.op2.active && savedState.op2.messageId) {
            console.log('🔄 Restauration 2ème Présence OP depuis fichier...');
            const restored = await restoreReactionsFromMessage(savedState.op2.messageId, reactionsOP2);
            if (restored) {
                presence2Data.messageId = savedState.op2.messageId;
                presence2Data.active = true;
                op2Restored = true;
                console.log('✅ 2ème Présence OP restaurée');
            } else {
                console.log('⚠️ Message 2ème OP introuvable');
            }
        }
    }

    // FALLBACK : scanner le salon présence si rien n'a été restauré
    // (couvre le cas où le fichier state est manquant/corrompu mais qu'une présence est en cours)
    if (!op1Restored || !op2Restored) {
        try {
            const presenceChannel = client.guilds.cache.get(CONFIG.GUILD_ID)?.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
            if (presenceChannel) {
                console.log('🔍 Scan du salon présence pour récupérer une OP en cours...');
                const messages = await presenceChannel.messages.fetch({ limit: 30 }).catch(() => null);
                if (messages) {
                    // Chercher les messages bot non périmés (< 24h)
                    const now = Date.now();
                    const ONE_DAY = 24 * 60 * 60 * 1000;

                    for (const [, msg] of messages) {
                        if (msg.author.id !== client.user.id) continue;
                        if (now - msg.createdTimestamp > ONE_DAY) continue;

                        const content = msg.content || '';

                        // Détection 1ère présence OP (contient "Présence OP" + role mention)
                        if (!op1Restored && /Présence OP/i.test(content) && content.includes(`<@&${CONFIG.ROLES.MEMBRE_1}>`) && /20H45|21H00/i.test(content)) {
                            console.log(`🔄 OP1 détectée dans le salon (msg ${msg.id})`);
                            const restored = await restoreReactionsFromMessage(msg.id, reactionsOP1);
                            if (restored) {
                                presenceData.messageId = msg.id;
                                presenceData.active = true;
                                op1Restored = true;
                                savePresenceState();
                                startPresenceReminders(presenceChannel, msg);
                                console.log('✅ 1ère Présence OP récupérée depuis le salon');
                            }
                        }

                        // Détection 2ème présence OP (contient "Merci de réagir si vous êtes présent")
                        if (!op2Restored && /Merci de réagir si vous êtes présent/i.test(content)) {
                            console.log(`🔄 OP2 détectée dans le salon (msg ${msg.id})`);
                            const restored = await restoreReactionsFromMessage(msg.id, reactionsOP2);
                            if (restored) {
                                presence2Data.messageId = msg.id;
                                presence2Data.active = true;
                                op2Restored = true;
                                savePresenceState();
                                console.log('✅ 2ème Présence OP récupérée depuis le salon');
                            }
                        }
                    }

                    if (!op1Restored && !op2Restored) {
                        console.log('ℹ️ Aucune OP active détectée dans le salon');
                    }
                }
            }
        } catch (e) {
            console.error('❌ Erreur scan salon présence:', e.message);
        }
    }

    cron.schedule('0 22 * * 0', () => {
        console.log('📊 RESET HEBDO ABSENCES');
        absenceTracking.clear();
        saveAbsenceTracking();
    }, { timezone: 'Europe/Paris' });

    if (TURBO_MODE) setTimeout(() => sendPresenceMessage(), 3_000);
});


}

module.exports = {
    registerReadyEvent,
};
