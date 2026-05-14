// STABILISATION 15/05/2026 — corrections runtime post-audit
// MODIFIE CHANTIER 6 - 14/05/2026 - flux presence OP externalise

function createStateProxy(getter) {
    return new Proxy({}, {
        get(_target, prop) {
            return getter()[prop];
        },
        set(_target, prop, value) {
            getter()[prop] = value;
            return true;
        },
    });
}

function createPresenceFlowService(deps) {
    const {
        CONFIG,
        TIMERS,
        PRESENCE_ENABLED,
        PRESENCE_CRON,
        TEST_MODE,
        TURBO_MODE,
        client,
        cron,
        sleep,
        addPresenceReactions,
        reactionsOP1,
        reactionsOP2,
        getPresenceData,
        setPresenceData,
        getPresence2Data,
        setPresence2Data,
        getPresenceItems,
        getCustomPresenceMessage,
        getAbsenceTracking,
        savePresenceState,
        saveAbsenceTracking,
        refreshAbsencePanel,
        stopAbsencePanelRefresh,
        clearAbsencePanelState,
        getConsecutiveDays,
    } = deps;

    const presenceData = createStateProxy(getPresenceData);
    const presence2Data = createStateProxy(getPresence2Data);
    const absenceTracking = getAbsenceTracking();

async function sendPresence2Message(channelOverride) {
    const channelId = channelOverride || CONFIG.CHANNELS.PRESENCE;
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    // Heure Paris (pas UTC)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}H${String(now.getMinutes()).padStart(2, '0')}`;
    const itemsList = getPresenceItems().map(item => `- ${item}`).join('\n');

    const text =
        `Deuxième **Présence OP** du ${dateStr} à **${timeStr}**\n` +
        `Merci de réagir si vous êtes présent actuellement à l'OP ${CONFIG.EMOJIS.BS21}\n\n` +
        `${itemsList}\n\n` +
        `*Aucun oubli toléré* ${CONFIG.EMOJIS.ATTENTION}\n\n` +
        `Afin d'être prêt à partir de nouveau en convoi\n` +
        `Réaction obligatoire : ${CONFIG.EMOJIS.CHECK} Présent ${CONFIG.EMOJIS.RETARD} Retard ${CONFIG.EMOJIS.NO} Absent\n` +
        `**Merci de mettre une absence dans le salon <#${CONFIG.CHANNELS.ABSENCE}> si vous n'êtes pas présent. Expliquer la raison ${CONFIG.EMOJIS.ATTENTION}**\n\n` +
        `*Respecter la Template c'est important ${CONFIG.EMOJIS.ATTENTION}*`;

    try {
        const msg = await channel.send({ content: text });
        await addPresenceReactions(msg, [
            CONFIG.REACT_EMOJIS.CHECK,
            CONFIG.REACT_EMOJIS.RETARD,
            CONFIG.REACT_EMOJIS.NO,
        ]);

        presence2Data.messageId = msg.id;
        presence2Data.active = true;
        reactionsOP2.clear();
        savePresenceState();
        console.log(`📋 2ème Présence OP envoyée (${dateStr} ${timeStr})`);
        await refreshAbsencePanel();

        // Suppression auto après 30 minutes
        setTimeout(async () => {
            try {
                const oldMsg = await channel.messages.fetch(msg.id);
                await oldMsg.delete();
                console.log('🗑️ 2ème Présence OP supprimée (30min)');
            } catch {}
            setPresence2Data({ messageId: null, active: false }); reactionsOP2.clear(); savePresenceState();
            await refreshAbsencePanel();
        }, 30 * 60 * 1000);
    } catch (error) {
        console.error('❌ Erreur 2ème OP:', error);
    }
}

// ==========================================
// PRÉSENCE OP (Cron 17h30)
// ==========================================
function setupPresenceCron() {
    if (!PRESENCE_ENABLED) return;
    cron.schedule(PRESENCE_CRON, () => sendPresenceMessage(), { timezone: 'Europe/Paris' });
    console.log(`⏰ Cron présence: ${PRESENCE_CRON}`);
}

async function sendPresenceMessage(channelOverride) {
    if (presenceData.active) return;
    presenceData.active = true;

    const channelId = channelOverride || CONFIG.CHANNELS.PRESENCE;
    const channel = client.channels.cache.get(channelId);
    if (!channel) { presenceData.active = false; return; }

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const itemsList = getPresenceItems().map(x => `- ${x}`).join('\n');

    let text;
    const customPresenceMessage = getCustomPresenceMessage();
    if (customPresenceMessage) {
        text = customPresenceMessage
            .replace('{date}', dateStr)
            .replace('{emojis}', `${CONFIG.EMOJIS.CHECK} Présent ${CONFIG.EMOJIS.RETARD} Retard ${CONFIG.EMOJIS.NO} Absent`);
    } else {
        text = `<@&${CONFIG.ROLES.MEMBRE_1}>\n\n**Présence OP** du ${dateStr} à **21H00**\nSoyez présent à **20H45.**\n\n${itemsList}\n\nAucun oubli toléré ${CONFIG.EMOJIS.ATTENTION}\n\nAfin d'être prêt à partir en convoi une fois l'appel effectué.\nRéaction obligatoire : ${CONFIG.EMOJIS.CHECK} Présent ${CONFIG.EMOJIS.RETARD} Retard ${CONFIG.EMOJIS.NO} Absent\n\nMerci de mettre une absence dans le salon <#${CONFIG.CHANNELS.ABSENCE}> si vous n'êtes pas présent. Respecter la Template c'est **important** ${CONFIG.EMOJIS.ATTENTION}`;
    }

    try {
        const msg = await channel.send({ content: text, allowedMentions: { parse: ['roles'] } });
    await addPresenceReactions(msg, [
        CONFIG.REACT_EMOJIS.CHECK,
        CONFIG.REACT_EMOJIS.RETARD,
        CONFIG.REACT_EMOJIS.NO,
    ]);

        presenceData.messageId = msg.id;
        presenceData.reminderIds = [];
        reactionsOP1.clear();
        savePresenceState();
        console.log(`📋 1ère Présence OP envoyée (${dateStr})`);

        startPresenceReminders(channel, msg);
        await refreshAbsencePanel();
    } catch (error) {
        console.error('❌ Erreur présence:', error);
        presenceData.active = false;
    }
}

// Variable globale pour empêcher les doublons de crons de présence
const presenceCronJobs = new Map();

function replacePresenceCron(key, expression, handler) {
    const existing = presenceCronJobs.get(key);
    if (existing && typeof existing.stop === 'function') {
        existing.stop();
    }
    const job = cron.schedule(expression, handler, { timezone: 'Europe/Paris' });
    presenceCronJobs.set(key, job);
    return job;
}

async function startPresenceReminders(channel, presenceMsg) {
    let stopped = false;

    const doReminder = async (isLast) => {
        if (stopped) return;
        const mentionMsgs = await mentionNonReactors(channel, presenceMsg);
        if (mentionMsgs.length === 0 && !isLast) { stopped = true; return; }
        if (mentionMsgs.length > 0) {
            setTimeout(async () => { for (const m of mentionMsgs) { await m.delete().catch(() => {}); await sleep(300); } }, TIMERS.REMINDER_DELETE_DELAY);
        }
        if (isLast) stopped = true;
    };

    if (TEST_MODE || TURBO_MODE) {
        if (presenceData.reminderInterval) clearInterval(presenceData.reminderInterval);
        presenceData.reminderInterval = setInterval(() => doReminder(false), TIMERS.PRESENCE_RAPPEL_INTERVAL);
    } else {
        // Empêcher les doublons : si les crons sont déjà programmés, on ne les recrée pas
        {
            ['0 18', '30 18', '0 19', '30 19', '0 20', '45 20'].forEach((t, i, a) => {
                replacePresenceCron(`reminder:${t}`, `${t} * * *`, () => {
                    if (presenceData.active && presenceData.messageId) doReminder(i === a.length - 1);
                });
            });

            // 21h05 — Avertissements
            replacePresenceCron('warnings:21h05', '5 21 * * *', async () => {
                stopped = true;
                if (presenceData.reminderInterval) { clearInterval(presenceData.reminderInterval); presenceData.reminderInterval = null; }
                if (!presenceData.active || !presenceData.messageId) return;
                await sendPresenceWarnings(channel);
                await refreshAbsencePanel();
            });

            // 21h20 — Suppression message 1ère OP
            replacePresenceCron('delete-op1:21h20', '20 21 * * *', async () => {
                if (!presenceData.messageId) return;
                console.log('🗑️ 21h20 : Suppression 1ère présence OP');
                try {
                    const msg = await channel.messages.fetch(presenceData.messageId);
                    await msg.delete();
                } catch {}
            });

            // 22h00 — Nettoyage des messages Discord (présence reste visible sur le site)
            replacePresenceCron('cleanup:22h00', '0 22 * * *', async () => {
                if (!presenceData.active && !presence2Data.active) return;
                console.log('🌙 22h — Nettoyage messages Discord (le panel site reste actif jusqu\'à 2h)');
                stopAbsencePanelRefresh();

                // Supprimer les messages Discord mais garder l'état actif
                if (presenceData.messageId) {
                    try { const m = await channel.messages.fetch(presenceData.messageId); await m.delete(); } catch {}
                    if (presenceData.reminderInterval) clearInterval(presenceData.reminderInterval);
                    presenceData.reminderInterval = null;
                    presenceData.reminderIds = [];
                }
                if (presence2Data.messageId) {
                    try { const m = await channel.messages.fetch(presence2Data.messageId); await m.delete(); } catch {}
                }
                // L'état reste 'active' avec les données de réactions pour que le site continue à les montrer
                savePresenceState();
            });

            // 2h00 du matin — Reset complet (présence disparaît du site)
            replacePresenceCron('reset:02h00', '0 2 * * *', async () => {
                console.log('🌃 2h — Reset complet présence (site + état)');
                clearAbsencePanelState();
                if (presenceData.reminderInterval) clearInterval(presenceData.reminderInterval);
                setPresenceData({ messageId: null, reminderIds: [], reminderInterval: null, active: false });
                reactionsOP1.clear();
                setPresence2Data({ messageId: null, active: false });
                reactionsOP2.clear();
                savePresenceState();
                try { await refreshAbsencePanel(); } catch {}
            });
            console.log('🔔 Crons présence remplacés : rappels 18h-20h45, avertissements 21h05, suppression 21h20, cleanup messages 22h, reset complet 2h');
        }

        // Mode TEST/TURBO : on lance des crons * * * * * temporaires
        if (TEST_MODE || TURBO_MODE) {
            replacePresenceCron('test:warnings', '* * * * *', async () => {
                stopped = true;
                if (presenceData.reminderInterval) { clearInterval(presenceData.reminderInterval); presenceData.reminderInterval = null; }
                if (!presenceData.active || !presenceData.messageId) return;
                await sendPresenceWarnings(channel);
                await refreshAbsencePanel();
            });
        }
    }
}

async function mentionNonReactors(channel, presenceMsg) {
    const mentionMsgs = [];
    try {
        // Utiliser la Map cachée au lieu de fetch les réactions API
        const reacted = new Set(reactionsOP1.keys());

        // Refetch absences salon pour avoir les plus récentes
        const { validAbsences } = await getAbsentUsersToday();

        // Membres en cache (déjà fetchés au boot)
        const guild = channel.guild;
        if (guild.members.cache.size < 5) await guild.members.fetch();
        const role = guild.roles.cache.get(CONFIG.ROLES.MEMBRE_1);
        if (!role) return mentionMsgs;

        const nr = role.members.filter(m =>
            !reacted.has(m.id) &&
            !m.user.bot &&
            !m.roles.cache.has(CONFIG.ROLES.EXCLUDED_ROLE) &&
            !validAbsences.has(m.id)
        );

        for (const [, member] of nr) {
            mentionMsgs.push(await channel.send(`${member} Tu n'as pas encore réagi à la **Présence OP**, merci de le faire ou pose une absence dans <#${CONFIG.CHANNELS.ABSENCE}>`));
            await sleep(500);
        }
    } catch (error) { console.error('❌ Erreur mentions:', error.message); }
    return mentionMsgs;
}

// ==========================================
// PARSING ABSENCES
// ==========================================
async function getAbsentUsersToday() {
    const validAbsences = new Set(), invalidAbsences = new Set();
    const validAbsenceNames = [], invalidAbsenceNames = [];
    const ch = client.channels.cache.get(CONFIG.CHANNELS.ABSENCE);
    if (!ch) return { validAbsences, invalidAbsences, validAbsenceNames, invalidAbsenceNames };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const msgs = await Promise.race([
            ch.messages.fetch({ limit: 100, signal: controller.signal }),
            new Promise((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error('timeout fetch salon absences')), { once: true });
            }),
        ]).finally(() => clearTimeout(timeout));
        const today = new Date(), td = today.getDate(), tm = today.getMonth() + 1;

        for (const [, m] of msgs) {
            if (m.author.bot) continue;
            const c = m.content;
            const valid = /Nom\s*:/i.test(c) && /Pr[ée]nom\s*:/i.test(c) && /Date\(?s?\)?\s*:/i.test(c) && /Raison\s*:/i.test(c);
            const displayName = m.member?.nickname || m.author.username;

            if (!valid) {
                if (m.createdAt.getDate() === td && m.createdAt.getMonth() + 1 === tm) {
                    invalidAbsences.add(m.author.id);
                    invalidAbsenceNames.push(displayName);
                }
                continue;
            }

            const dm = c.match(/Date\(?s?\)?\s*:\s*(.+)/i);
            if (!dm) continue;
            const ds = dm[1].trim();

            const rng = ds.match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/);
            if (rng) {
                const y = today.getFullYear();
                if (new Date(y, tm - 1, td) >= new Date(y, +rng[2] - 1, +rng[1]) && new Date(y, tm - 1, td) <= new Date(y, +rng[4] - 1, +rng[3])) {
                    validAbsences.add(m.author.id);
                    validAbsenceNames.push(displayName);
                }
                continue;
            }

            const sm = ds.match(/(\d{1,2})\/(\d{1,2})/);
            if (sm && +sm[1] === td && +sm[2] === tm) {
                validAbsences.add(m.author.id);
                validAbsenceNames.push(displayName);
            }
        }
    } catch (e) {
        console.warn('⚠️ Lecture salon absences interrompue:', e.message);
    }
    return { validAbsences, invalidAbsences, validAbsenceNames, invalidAbsenceNames };
}

async function cleanupPresence(channel) {
    try {
        for (const id of presenceData.reminderIds) { try { const m = await channel.messages.fetch(id); await m.delete(); } catch {} await sleep(300); }
        if (presenceData.messageId) { try { const m = await channel.messages.fetch(presenceData.messageId); await m.delete(); } catch {} }
        const msgs = await channel.messages.fetch({ limit: 50 });
        for (const [, m] of msgs.filter(m => m.author.id === client.user.id)) { await m.delete().catch(() => {}); await sleep(300); }
        setPresenceData({ messageId: null, reminderIds: [], reminderInterval: null, active: false }); reactionsOP1.clear(); savePresenceState();
    } catch {}
}

// ==========================================
// AVERTISSEMENTS
// ==========================================
async function sendPresenceWarnings(presenceChannel) {
    console.log('⚠️ VÉRIFICATION AVERTISSEMENTS');
    try {
        const guild = presenceChannel.guild;
        if (guild.members.cache.size < 5) await guild.members.fetch();
        const role = guild.roles.cache.get(CONFIG.ROLES.MEMBRE_1);
        if (!role) return;

        const { validAbsences, invalidAbsences } = await getAbsentUsersToday();
        const avertCh = client.channels.cache.get(CONFIG.CHANNELS.AVERTISSEMENT);
        const today = new Date();
        const todayStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}`;

        function recordUnjustifiedAbsence(member, opName, dateLabel, reason = null) {
            const t = absenceTracking.get(member.id) || { count: 0, dates: [], details: [], username: '' };
            t.details = t.details || [];
            t.dates = t.dates || [];

            const alreadyRecorded = t.details.some(d =>
                d.date === todayStr &&
                d.op === opName &&
                !d.justified &&
                (d.reason || null) === reason
            );

            if (!alreadyRecorded) {
                t.count = (Number(t.count) || 0) + 1;
                t.dates.push(`${todayStr} (${dateLabel})`);
                const detail = { date: todayStr, op: opName, justified: false };
                if (reason) detail.reason = reason;
                t.details.push(detail);
            }

            t.username = member.nickname || member.user.username;
            absenceTracking.set(member.id, t);
            return t;
        }

        // Utiliser les Maps de réaction (pas d'appel API)
        function processOP(opName, reactionMap) {
            if (!reactionMap || reactionMap.size === 0) return { noReact: [], reacted: new Set() };

            const reacted = new Set(reactionMap.keys());
            const noReact = [];

            for (const [, member] of role.members) {
                if (member.user.bot) continue;
                if (member.roles.cache.has(CONFIG.ROLES.EXCLUDED_ROLE)) continue;
                if (reacted.has(member.id)) continue;
                if (validAbsences.has(member.id)) continue;
                if (invalidAbsences.has(member.id)) continue;
                noReact.push(member);
            }

            return { noReact, reacted };
        }

        // === 1ère OP ===
        if (presenceData.active && presenceData.messageId) {
            const { noReact, reacted } = processOP('1ère Présence OP', reactionsOP1);

            for (const member of noReact) {
                const t = recordUnjustifiedAbsence(member, '1ère Présence OP', '1ère OP');

                if (avertCh) {
                    await avertCh.send(
                        `\n❌ ${member} — **Absence non justifiée**\n\n` +
                        `📋 OP : **1ère Présence OP** du ${todayStr}\n` +
                        `📊 Total absences semaine : **${t.count}**\n` +
                        `🔍 Statut : Pas de réaction + pas d'absence posée ${CONFIG.EMOJIS.BS21}\n` +
                        `─────────────────────────────`
                    );
                }

                await member.send(
                    `Salut ! Tu n'as pas réagi à la **1ère Présence OP** du ${todayStr} et tu n'as pas posé d'absence.\n\n` +
                    `**Avertissement** — ${t.count}e absence non justifiée cette semaine.\n` +
                    `Pense à réagir ou poser une absence la prochaine fois.\nA bientôt ! ${CONFIG.EMOJIS.BS21}`
                ).catch(() => {});

                // Alerte KP uniquement si 2+ jours CONSÉCUTIFS
                const consecutiveDays = getConsecutiveDays(t);
                if (consecutiveDays >= 2 && avertCh) {
                    await avertCh.send({
                        content: `\n<@&${CONFIG.ROLES.ALERT_ROLE}> ${CONFIG.EMOJIS.ATTENTION} ${member} est absent depuis **${consecutiveDays} jours consécutifs** sans justification (${t.count} absences cette semaine). Il faudrait penser à le KP ${CONFIG.EMOJIS.BS21}\n`,
                        allowedMentions: { parse: ['roles'] }
                    });
                }

                await sleep(500);
            }

            // Template non conforme
            if (avertCh) {
                for (const [, member] of role.members) {
                    if (member.user.bot) continue;
                    if (reacted.has(member.id)) continue;
                    if (!invalidAbsences.has(member.id)) continue;

                    const t = recordUnjustifiedAbsence(member, '1ère Présence OP', '1ère OP', 'Template non conforme');

                    await avertCh.send(
                        `\n⚠️ ${member} — **Template absence non conforme**\n\n` +
                        `📋 OP : **1ère Présence OP** du ${todayStr}\n` +
                        `🔍 A posé une absence mais le format n'est pas respecté\n` +
                        `📝 Format attendu : Nom / Prénom / Date(s) / Raison ${CONFIG.EMOJIS.BS21}\n` +
                        `─────────────────────────────`
                    );
                    await member.send(
                        `Salut ! Tu as posé une absence pour la **1ère Présence OP** du ${todayStr} mais ta template n'est pas conforme.\n` +
                        `Format :\n> Nom :\n> Prénom :\n> Date(s) :\n> Raison :\n\n**Avertissement**.\nA bientôt ! ${CONFIG.EMOJIS.BS21}`
                    ).catch(() => {});
                    await sleep(500);
                }
            }

            // Les réactions ne doivent pas supprimer l'historique hebdomadaire déjà enregistré.
            saveAbsenceTracking();
        }

        // === 2ème OP ===
        if (presence2Data.active && presence2Data.messageId) {
            const { noReact, reacted } = processOP('2ème Présence OP', reactionsOP2);

            for (const member of noReact) {
                const t = recordUnjustifiedAbsence(member, '2ème Présence OP', '2ème OP');

                if (avertCh) {
                    await avertCh.send(
                        `\n❌ ${member} — **Absence non justifiée**\n\n` +
                        `📋 OP : **2ème Présence OP** du ${todayStr}\n` +
                        `📊 Total absences semaine : **${t.count}**\n` +
                        `🔍 Statut : Pas de réaction + pas d'absence posée ${CONFIG.EMOJIS.BS21}\n` +
                        `─────────────────────────────`
                    );
                }

                await member.send(
                    `Salut ! Tu n'as pas réagi à la **2ème Présence OP** du ${todayStr} et tu n'as pas posé d'absence.\n\n` +
                    `**Avertissement** — ${t.count}e absence non justifiée cette semaine.\n` +
                    `Pense à réagir ou poser une absence la prochaine fois.\nA bientôt ! ${CONFIG.EMOJIS.BS21}`
                ).catch(() => {});

                // Alerte KP uniquement si 2+ jours CONSÉCUTIFS
                const consecutiveDays = getConsecutiveDays(t);
                if (consecutiveDays >= 2 && avertCh) {
                    await avertCh.send({
                        content: `\n<@&${CONFIG.ROLES.ALERT_ROLE}> ${CONFIG.EMOJIS.ATTENTION} ${member} est absent depuis **${consecutiveDays} jours consécutifs** sans justification (${t.count} absences cette semaine). Il faudrait penser à le KP ${CONFIG.EMOJIS.BS21}\n`,
                        allowedMentions: { parse: ['roles'] }
                    });
                }

                await sleep(500);
            }

            // Les réactions ne doivent pas supprimer l'historique hebdomadaire déjà enregistré.
            saveAbsenceTracking();
        }

        // Enregistrer les absences justifiées dans le tracking aussi (pour le suivi)
        for (const uid of validAbsences) {
            const guild2 = client.guilds.cache.get(CONFIG.GUILD_ID);
            const member = guild2 ? guild2.members.cache.get(uid) : null;
            if (member) {
                const t = absenceTracking.get(uid) || { count: 0, dates: [], details: [], username: '' };
                t.details = t.details || [];
                // Ne pas ajouter si déjà enregistré aujourd'hui comme justifié
                const alreadyToday = t.details.some(d => d.date === todayStr && d.justified);
                if (!alreadyToday) {
                    t.details.push({ date: todayStr, op: 'Absence salon', justified: true });
                    t.username = member.nickname || member.user.username;
                    absenceTracking.set(uid, t);
                }
            }
        }
        saveAbsenceTracking();

    } catch (error) {
        console.error('❌ Erreur avertissements:', error);
    }
}



    return {
        setupPresenceCron,
        sendPresence2Message,
        sendPresenceMessage,
        startPresenceReminders,
        mentionNonReactors,
        getAbsentUsersToday,
        cleanupPresence,
        sendPresenceWarnings,
    };
}

module.exports = {
    createPresenceFlowService,
};
