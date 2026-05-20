// RELANCE ABSENCE + CONTRASTE 19/05/2026
// STATS PRÉSENCE 19/05/2026 — snapshots minuit + dashboard stats
// HISTORIQUE PRÉSENCE 19/05/2026 — persistance + 7 jours
// BOARD ARMES 17/05/2026 — init board armes live au ready
// FINAL D2 16/05/2026 ? logs bot via pino
// QUICK WINS 5 18/05/2026 — cron stats hebdomadaires Discord
const log = require('../../shared/logger');
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
        scheduleWeeklyStats,
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
        initArmesBoard,
        getParisDateKey,
        hasPresenceSnapshot,
        snapshotPresenceDay,
        expirePresenceAtMidnight,
        initAbsenceReminder,
    } = deps;

function getYesterdayParisKey() {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return getParisDateKey ? getParisDateKey(yesterday) : yesterday.toISOString().slice(0, 10);
}

async function runPresenceSnapshot(dateStr, options = {}, label = 'snapshot') {
    if (typeof snapshotPresenceDay !== 'function') return false;
    const ok = await snapshotPresenceDay(dateStr, options);
    if (ok) log.info(`📸 ${label} pour ${dateStr}`);
    return ok;
}

async function catchUpYesterdaySnapshot() {
    if (typeof hasPresenceSnapshot !== 'function') return;
    const dateStr = getYesterdayParisKey();
    if (hasPresenceSnapshot(dateStr)) return;
    if (!reactionsOP1.size && !reactionsOP2.size) return;
    await runPresenceSnapshot(dateStr, {}, 'Rattrapage snapshot au boot').catch(e => {
        log.error(`❌ Rattrapage snapshot ${dateStr} échoué: ${e.message}`);
    });
}

client.once('ready', async () => {
    log.info(`🤖 ${client.user.tag} connecté | ${client.guilds.cache.size} serveur(s)`);
    await registerCommands();
    setupPresenceCron();
    scheduleDailyBackups();
    scheduleWeeklyStats?.(client);
    log.info('📊 Cron stats hebdomadaires programmé (dimanche 19h Paris)');
    restoreAbsencePanelState();
    if (initArmesBoard) {
        await initArmesBoard(client).catch(e => log.error({ err: e.message }, 'init armes board échoué'));
    }

    // Charger les rappels du panel
    loadReminders();
    restorePanelState();
    if (hasEnabledReminders()) {
        startReminderLoop();
        log.info('⏰ Boucle de rappels démarrée');
    }

    // Prefetch membres + absences au boot
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        if (guild) {
            await guild.members.fetch();
            log.info(`👥 ${guild.members.cache.size} membres mis en cache`);

            // Vérifier les auto-rôles
            for (const [userId, roleId] of Object.entries(CONFIG.AUTO_ROLE_USERS)) {
                try {
                    const member = guild.members.cache.get(userId);
                    if (member && !member.roles.cache.has(roleId)) {
                        const role = guild.roles.cache.get(roleId);
                        if (role) {
                            await member.roles.add(role);
                            log.info(`🎯 Auto-rôle restauré pour ${member.user.tag}`);
                        }
                    }
                } catch {}
            }
        }
        await updateAbsenceSalonCache();
        restoreRenameChecks?.();
        log.info('📋 Cache absences salon initialisé');
    } catch (e) {
        log.error('⚠️ Erreur prefetch:', e.message);
    }

    // Restaurer l'état de présence si le bot a été redéployé en cours d'OP
    const savedState = loadPresenceState();
    let op1Restored = false;
    let op2Restored = false;

    if (savedState) {
        if (savedState.op1 && savedState.op1.messageId && (savedState.op1.active || savedState.op1.terminated)) {
            log.info('🔄 Restauration 1ère Présence OP depuis fichier...');
            const restored = await restoreReactionsFromMessage(savedState.op1.messageId, reactionsOP1);
            if (restored) {
                presenceData.messageId = savedState.op1.messageId;
                presenceData.active = Boolean(savedState.op1.active);
                presenceData.terminated = Boolean(savedState.op1.terminated);
                presenceData.startedAt = savedState.op1.startedAt || presenceData.startedAt || null;
                expirePresenceAtMidnight?.();
                op1Restored = true;
                log.info('✅ 1ère Présence OP restaurée');

                // Relancer les rappels et crons
                const channel = client.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
                if (channel) {
                    const msg = await channel.messages.fetch(savedState.op1.messageId).catch(() => null);
                    if (msg && presenceData.active) startPresenceReminders(channel, msg);
                }
            } else {
                log.info('⚠️ Message 1ère OP introuvable dans le fichier');
            }
        }

        if (savedState.op2 && savedState.op2.messageId && (savedState.op2.active || savedState.op2.terminated)) {
            log.info('🔄 Restauration 2ème Présence OP depuis fichier...');
            const restored = await restoreReactionsFromMessage(savedState.op2.messageId, reactionsOP2);
            if (restored) {
                presence2Data.messageId = savedState.op2.messageId;
                presence2Data.active = Boolean(savedState.op2.active);
                presence2Data.terminated = Boolean(savedState.op2.terminated);
                presence2Data.startedAt = savedState.op2.startedAt || presence2Data.startedAt || null;
                expirePresenceAtMidnight?.();
                op2Restored = true;
                log.info('✅ 2ème Présence OP restaurée');
            } else {
                log.info('⚠️ Message 2ème OP introuvable');
            }
        }
    }

    // FALLBACK : scanner le salon présence si rien n'a été restauré
    // (couvre le cas où le fichier state est manquant/corrompu mais qu'une présence est en cours)
    if (!op1Restored || !op2Restored) {
        try {
            const presenceChannel = client.guilds.cache.get(CONFIG.GUILD_ID)?.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
            if (presenceChannel) {
                log.info('🔍 Scan du salon présence pour récupérer une OP en cours...');
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
                            log.info(`🔄 OP1 détectée dans le salon (msg ${msg.id})`);
                            const restored = await restoreReactionsFromMessage(msg.id, reactionsOP1);
                            if (restored) {
                                presenceData.messageId = msg.id;
                                presenceData.active = true;
                                presenceData.terminated = false;
                                presenceData.startedAt = new Date(msg.createdTimestamp || Date.now()).toISOString();
                                expirePresenceAtMidnight?.();
                                op1Restored = true;
                                savePresenceState();
                                if (presenceData.active) startPresenceReminders(presenceChannel, msg);
                                log.info('✅ 1ère Présence OP récupérée depuis le salon');
                            }
                        }

                        // Détection 2ème présence OP (contient "Merci de réagir si vous êtes présent")
                        if (!op2Restored && /Merci de réagir si vous êtes présent/i.test(content)) {
                            log.info(`🔄 OP2 détectée dans le salon (msg ${msg.id})`);
                            const restored = await restoreReactionsFromMessage(msg.id, reactionsOP2);
                            if (restored) {
                                presence2Data.messageId = msg.id;
                                presence2Data.active = true;
                                presence2Data.terminated = false;
                                presence2Data.startedAt = new Date(msg.createdTimestamp || Date.now()).toISOString();
                                expirePresenceAtMidnight?.();
                                op2Restored = true;
                                savePresenceState();
                                log.info('✅ 2ème Présence OP récupérée depuis le salon');
                            }
                        }
                    }

                    if (!op1Restored && !op2Restored) {
                        log.info('ℹ️ Aucune OP active détectée dans le salon');
                    }
                }
            }
        } catch (e) {
            log.error('❌ Erreur scan salon présence:', e.message);
        }
    }

    await catchUpYesterdaySnapshot();

    cron.schedule('0 0 * * *', () => {
        const dateStr = getYesterdayParisKey();
        runPresenceSnapshot(dateStr, { only: 'op1' }, 'Snapshot OP1 à minuit')
            .catch(e => log.error(`❌ Snapshot OP1 minuit échoué: ${e.message}`));
    }, { timezone: 'Europe/Paris' });

    cron.schedule('0 1 * * *', () => {
        const dateStr = getYesterdayParisKey();
        runPresenceSnapshot(dateStr, { only: 'op2' }, 'Snapshot OP2 à 01h00')
            .catch(e => log.error(`❌ Snapshot OP2 01h00 échoué: ${e.message}`));
    }, { timezone: 'Europe/Paris' });

    cron.schedule('0 22 * * 0', () => {
        log.info('📊 RESET HEBDO ABSENCES');
        absenceTracking.clear();
        saveAbsenceTracking();
    }, { timezone: 'Europe/Paris' });

    initAbsenceReminder?.();

    if (TURBO_MODE) setTimeout(() => sendPresenceMessage(), 3_000);
});


}

module.exports = {
    registerReadyEvent,
};
