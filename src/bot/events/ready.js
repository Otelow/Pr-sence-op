// RESET HEBDO 31/05/2026 — dimanche 17h00
// PRÉSENCE RÉSILIENTE + DÉTAILS 20/05/2026
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
        deserializeReactionMap,
        restoreReactionsFromMessage,
        reactionsOP1,
        reactionsOP2,
        manualPresenceOverridesOP1 = new Map(),
        manualPresenceOverridesOP2 = new Map(),
        applyManualPresenceOverrides,
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
        validateDiscordConfig,
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

function restoreReactionMapFromDisk(label, savedOp, reactionMap, field = 'reactions') {
    if (typeof deserializeReactionMap !== 'function') return 0;
    if (!savedOp?.[field] || typeof savedOp[field] !== 'object') return 0;
    deserializeReactionMap(savedOp[field], reactionMap);
    log.info(`📥 Réactions ${label} restaurées depuis disk : ${reactionMap.size} user(s)`);
    return reactionMap.size;
}

function applySavedPresenceData(target, savedOp) {
    if (!savedOp) return;
    target.messageId = savedOp.messageId || target.messageId || null;
    target.active = Boolean(savedOp.active);
    target.terminated = Boolean(savedOp.terminated);
    target.startedAt = savedOp.startedAt || target.startedAt || null;
    target.remindersDisabled = Boolean(savedOp.remindersDisabled);
    target.launchSource = savedOp.launchSource || target.launchSource || null;
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
            validateDiscordConfig?.(client, CONFIG, log);

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
        const op1DiskUsers = restoreReactionMapFromDisk('OP1', savedState.op1, reactionsOP1);
        const op2DiskUsers = restoreReactionMapFromDisk('OP2', savedState.op2, reactionsOP2);
        restoreReactionMapFromDisk('OP1 manuelles', savedState.op1, manualPresenceOverridesOP1, 'manualOverrides');
        restoreReactionMapFromDisk('OP2 manuelles', savedState.op2, manualPresenceOverridesOP2, 'manualOverrides');

        if (savedState.op1 && (savedState.op1.messageId || savedState.op1.active || savedState.op1.terminated || op1DiskUsers > 0)) {
            log.info('🔄 Restauration 1ère Présence OP depuis fichier...');
            applySavedPresenceData(presenceData, savedState.op1);
            const restored = savedState.op1.messageId
                ? await restoreReactionsFromMessage(savedState.op1.messageId, reactionsOP1)
                : false;
            applyManualPresenceOverrides?.();
            expirePresenceAtMidnight?.();
            op1Restored = Boolean(restored || op1DiskUsers > 0);
            log.info(restored
                ? '✅ 1ère Présence OP restaurée depuis Discord'
                : `⚠️ Discord indisponible pour OP1, réactions disk conservées (${reactionsOP1.size} user(s))`);

            // Relancer les rappels et crons
            const channel = client.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
            if (channel && presenceData.messageId) {
                const msg = await channel.messages.fetch(presenceData.messageId).catch(() => null);
                if (msg && presenceData.active) startPresenceReminders(channel, msg);
            }
        }

        if (savedState.op2 && (savedState.op2.messageId || savedState.op2.active || savedState.op2.terminated || op2DiskUsers > 0)) {
            log.info('🔄 Restauration 2ème Présence OP depuis fichier...');
            applySavedPresenceData(presence2Data, savedState.op2);
            const restored = savedState.op2.messageId
                ? await restoreReactionsFromMessage(savedState.op2.messageId, reactionsOP2)
                : false;
            applyManualPresenceOverrides?.();
            expirePresenceAtMidnight?.();
            op2Restored = Boolean(restored || op2DiskUsers > 0);
            log.info(restored
                ? '✅ 2ème Présence OP restaurée depuis Discord'
                : `⚠️ Discord indisponible pour OP2, réactions disk conservées (${reactionsOP2.size} user(s))`);
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
                                presenceData.remindersDisabled = false;
                                presenceData.launchSource = presenceData.launchSource || 'restore-scan';
                                applyManualPresenceOverrides?.();
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
                                applyManualPresenceOverrides?.();
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

    try {
        const finalSync = [];
        if (presenceData.messageId) {
            finalSync.push(restoreReactionsFromMessage(presenceData.messageId, reactionsOP1));
        }
        if (presence2Data.messageId) {
            finalSync.push(restoreReactionsFromMessage(presence2Data.messageId, reactionsOP2));
        }
        if (finalSync.length > 0) {
            await Promise.allSettled(finalSync);
            applyManualPresenceOverrides?.();
            expirePresenceAtMidnight?.();
            savePresenceState?.();
            log.info(`✅ Check post-redémarrage présence terminé (OP1: ${reactionsOP1.size}, OP2: ${reactionsOP2.size})`);
        }
    } catch (e) {
        log.error(`❌ Check post-redémarrage présence échoué: ${e.message}`);
    }

    const todayStr = getParisDateKey ? getParisDateKey(new Date()) : new Date().toISOString().slice(0, 10);
    if (reactionsOP1.size > 0 || reactionsOP2.size > 0) {
        await runPresenceSnapshot(todayStr, {}, 'Snapshot de rattrapage au boot').catch(e => {
            log.error(`❌ Snapshot de rattrapage au boot ${todayStr} échoué: ${e.message}`);
        });
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

    cron.schedule('*/10 * * * *', async () => {
        if (typeof snapshotPresenceDay !== 'function') return;
        const currentDay = getParisDateKey ? getParisDateKey(new Date()) : new Date().toISOString().slice(0, 10);
        try {
            const hasOP1 = reactionsOP1.size > 0;
            const hasOP2 = reactionsOP2.size > 0;
            if (hasOP1 || hasOP2) {
                await snapshotPresenceDay(currentDay);
                log.debug(`📸 Snapshot intermédiaire ${currentDay} (OP1: ${reactionsOP1.size}, OP2: ${reactionsOP2.size})`);
            }
        } catch (e) {
            log.error('Snapshot intermédiaire échoué:', e.message);
        }
    }, { timezone: 'Europe/Paris' });

    cron.schedule('0 17 * * 0', () => {
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
