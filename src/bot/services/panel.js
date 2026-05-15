// STABILISATION FINALE 15/05/2026 - mentions salons explicites dans les rappels
// MODIFI? CHANTIER 6 ? 14/05/2026 ? service panel/rappels externalis?

const fs = require('fs');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');

function createPanelService(deps) {
    const {
        client,
        CONFIG,
        remindersFile,
        loadState,
        saveState,
        deleteState,
        emitRealtime,
    } = deps;

// ==========================================
// /PANEL — Panneau de contrôle (rappels programmés + sanctions + annonces)
// ==========================================
const PANEL_CONFIG = {
    PROTECTED_USER_ID: '952986899667103804',
    ANTI_COLLISION_MINUTES: 15,
    EMOJI_SHORTCUTS: {
        ':attention:': '<a:attention:1486396212398526545>',
        ':foret:':     '<:foret:1489601133772144670>',
        ':bm:':        '<:bm:1489337087282118686>',
        ':21bs:':      '<:21bs:1487618400443306055>',
        ':retard1:':   '<:retard1:1486400147654049924>',
        ':unity:':     '<a:unity:1487095378355683391>',
        ':no:':        '<a:no:1486417914084069507>',
        ':evilcat:':   '<a:evilcat:1486401078386753706>',
        ':catwave:':   '<a:catwave:1486401049513431221>',
        ':retard2:':   '<a:retard2:1486400179832885378>',
        ':check:':     '<a:check:1486393925219647519>',
        ':lspd:':      '<:lspd:1495451609084334220>',
    },
};

const REMINDERS_FILE = remindersFile;
let reminders = [];
let nextReminderId = 1;
let reminderLoopTimer = null;
let panelMessageId = null;
let panelChannelId = null;

function savePanelState() {
    if (!panelMessageId || !panelChannelId) return deleteState('panel');
    saveState('panel', { messageId: panelMessageId, channelId: panelChannelId });
}

function restorePanelState() {
    const saved = loadState('panel', null);
    if (!saved?.messageId || !saved?.channelId) return;
    panelMessageId = saved.messageId;
    panelChannelId = saved.channelId;
    console.log(`🎮 Panel restauré depuis SQLite: ${panelMessageId}`);
}

// Persistance des rappels
function loadReminders() {
    try {
        const persisted = loadState('reminders', null);
        if (persisted && Array.isArray(persisted.reminders)) {
            reminders = persisted.reminders;
            nextReminderId = persisted.nextId || 1;
        } else if (fs.existsSync(REMINDERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
            reminders = data.reminders || [];
            nextReminderId = data.nextId || 1;
            saveState('reminders', { reminders, nextId: nextReminderId });
        }

        if (reminders.length) {
            const minutes = getParisMinutes();
            const elapsed = getElapsedMinutes(minutes);
            let migrated = false;
            for (const reminder of reminders) {
                if (typeof reminder.lastSentMinute !== 'number') {
                    reminder.lastSentMinute = elapsed >= 0
                        ? Math.max(0, elapsed - (Number(reminder.interval) || 60))
                        : null;
                    migrated = true;
                }
            }
            if (migrated) saveReminders();
            console.log(`📋 ${reminders.length} rappel(s) restauré(s)`);
        }
    } catch (e) {
        console.error('❌ Erreur chargement rappels:', e.message);
    }
}

function saveReminders() {
    try {
        fs.writeFileSync(REMINDERS_FILE, JSON.stringify({ reminders, nextId: nextReminderId }, null, 2));
        saveState('reminders', { reminders, nextId: nextReminderId });
        emitRealtime('reminder:changed', { total: reminders.length });
    } catch (e) {
        console.error('❌ Erreur sauvegarde rappels:', e.message);
    }
}

function formatPanelMessage(text) {
    let result = text.replace(/\\n/g, '\n');
    for (const [shortcut, full] of Object.entries(PANEL_CONFIG.EMOJI_SHORTCUTS)) {
        result = result.replaceAll(shortcut, full);
    }
    result = result.replace(/:salon:(\d{17,20})\b/g, '<#$1>');
    return result;
}

function isInPanelTimeRange() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const hour = now.getHours();
    return hour >= 12 || hour < 3;
}

function getParisMinutes() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    return now.getHours() * 60 + now.getMinutes();
}

function getElapsedMinutes(minutes) {
    const startMinute = 12 * 60;
    if (minutes >= startMinute) return minutes - startMinute;
    if (minutes < 3 * 60) return (24 * 60 - startMinute) + minutes;
    return -1;
}

function buildPanelContent() {
    let lines = [
        '```',
        '╔══════════════════════════════════════╗',
        '║      🎮  PANNEAU DE CONTRÔLE  🎮     ║',
        '╠══════════════════════════════════════╣',
        '║                                      ║',
        '║  📢 Annonce   → Envoyer une annonce  ║',
        '║  📌 Rappel    → Envoyer un rappel    ║',
        '║  ⚠️ Sanction  → Sanctionner          ║',
        '║                                      ║',
        '╠══════════════════════════════════════╣',
        '║       ⏰  RAPPELS PROGRAMMÉS         ║',
        '╠══════════════════════════════════════╣',
    ];

    if (reminders.length === 0) {
        lines.push('║  Aucun rappel programmé              ║');
    } else {
        for (const r of reminders) {
            const status = r.enabled ? '✅' : '💤';
            const preview = r.message.length > 35 ? r.message.substring(0, 35) + '…' : r.message;
            lines.push(`║  ${status} #${r.id} | ${r.interval}min | ${preview}`);
        }
    }

    lines.push(
        '║                                      ║',
        '║  Horaires : 12h00 → 03h00            ║',
        '║  Anti-collision : 15 min             ║',
        '║                                      ║',
        '╚══════════════════════════════════════╝',
        '```',
    );

    return lines.join('\n');
}

function buildPanelRows() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_annonce').setLabel('📢 Annonce').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_rappel').setLabel('📌 Rappel').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_sanction').setLabel('⚠️ Sanction').setStyle(ButtonStyle.Danger),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_programmer').setLabel('⏰ Programmer').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('btn_toggle').setLabel('💤 Activer/Désactiver').setStyle(ButtonStyle.Secondary).setDisabled(reminders.length === 0),
        new ButtonBuilder().setCustomId('btn_delete_reminder').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger).setDisabled(reminders.length === 0),
    );

    return [row1, row2];
}

async function refreshPanel() {
    if (!panelMessageId || !panelChannelId) return;
    try {
        const channel = await client.channels.fetch(panelChannelId);
        const msg = await channel.messages.fetch(panelMessageId);
        await msg.edit({ content: buildPanelContent(), components: buildPanelRows() });
    } catch {
        panelMessageId = null;
        panelChannelId = null;
        savePanelState();
    }
}

async function sendReminderMessage(reminder) {
    if (!reminder.enabled) return;
    if (!isInPanelTimeRange()) return;

    try {
        const channel = await client.channels.fetch(CONFIG.CHANNELS.RAPPELS_PANEL);

        if (reminder.lastMessageId) {
            try {
                const oldMsg = await channel.messages.fetch(reminder.lastMessageId);
                await oldMsg.delete();
            } catch {}
        }

        const sent = await channel.send({
            content: `${reminder.message}\n\n||<@&${CONFIG.ROLES.MEMBRE_1}>||`,
            allowedMentions: { parse: ['roles'] },
        });

        reminder.lastMessageId = sent.id;
        const elapsed = getElapsedMinutes(getParisMinutes());
        if (elapsed >= 0) reminder.lastSentMinute = elapsed;
        saveReminders();
    } catch (err) {
        console.error(`❌ Erreur envoi rappel #${reminder.id}:`, err.message);
    }
}

function startReminderLoop() {
    stopReminderLoop();
    reminderLoopTimer = setInterval(async () => {
        if (reminders.length === 0) return;

        const minutes = getParisMinutes();
        const elapsed = getElapsedMinutes(minutes);
        if (elapsed < 0) return;

        const toSend = reminders.filter(r => {
            if (!r.enabled) return false;
            const interval = Number(r.interval) || 60;
            if (typeof r.lastSentMinute !== 'number') {
                r.lastSentMinute = Math.max(0, elapsed - interval);
            }
            return elapsed - r.lastSentMinute >= interval;
        });
        if (toSend.length === 0) return;

        for (let i = 0; i < toSend.length; i++) {
            setTimeout(async () => {
                await sendReminderMessage(toSend[i]);
                if (i === toSend.length - 1) await refreshPanel();
            }, i * PANEL_CONFIG.ANTI_COLLISION_MINUTES * 60 * 1000);
        }
    }, 60_000);
}

function stopReminderLoop() {
    if (reminderLoopTimer) {
        clearInterval(reminderLoopTimer);
        reminderLoopTimer = null;
    }
}

function buildReminderSelectMenu(customId, placeholder) {
    if (reminders.length === 0) return null;
    const menu = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .addOptions(
            reminders.map(r => {
                const status = r.enabled ? '✅' : '💤';
                const preview = r.message.length > 50 ? r.message.substring(0, 50) + '…' : r.message;
                return {
                    label: `#${r.id} — ${r.interval}min`,
                    description: `${status} ${preview}`.substring(0, 100),
                    value: String(r.id),
                };
            }),
        );
    return new ActionRowBuilder().addComponents(menu);
}

async function handlePanel(interaction) {
    const reply = await interaction.reply({
        content: buildPanelContent(),
        components: buildPanelRows(),
        fetchReply: true,
    });

    panelMessageId = reply.id;
    panelChannelId = reply.channelId;
    savePanelState();

    if (reminders.some(r => r.enabled)) startReminderLoop();
}

// Handler des interactions du panel (boutons, modals, selects)
async function handlePanelInteraction(interaction) {
    // ─── SELECT MENUS ─────────────────────────────────
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_toggle') {
            const id = Number(interaction.values[0]);
            const reminder = reminders.find(r => r.id === id);
            if (!reminder) return interaction.reply({ content: '❌ Rappel introuvable', ephemeral: true });

            reminder.enabled = !reminder.enabled;
            const status = reminder.enabled ? '✅ Activé' : '💤 Désactivé';

            if (reminders.some(r => r.enabled)) startReminderLoop();
            else stopReminderLoop();

            saveReminders();
            await interaction.reply({ content: `${status} — Rappel #${reminder.id}`, ephemeral: true });
            await refreshPanel();
            return true;
        }

        if (interaction.customId === 'select_delete') {
            const id = Number(interaction.values[0]);
            const index = reminders.findIndex(r => r.id === id);
            if (index === -1) return interaction.reply({ content: '❌ Rappel introuvable', ephemeral: true });

            const removed = reminders[index];
            if (removed.lastMessageId) {
                try {
                    const channel = await client.channels.fetch(CONFIG.CHANNELS.RAPPELS_PANEL);
                    const oldMsg = await channel.messages.fetch(removed.lastMessageId);
                    await oldMsg.delete();
                } catch {}
            }

            reminders.splice(index, 1);
            if (reminders.length === 0) stopReminderLoop();
            saveReminders();

            await interaction.reply({ content: `🗑️ Rappel #${removed.id} supprimé`, ephemeral: true });
            await refreshPanel();
            return true;
        }
        return false;
    }

    // ─── MODALS ───────────────────────────────────────
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_rappel') {
            const msg = formatPanelMessage(interaction.fields.getTextInputValue('rappel_message'));
            try {
                const channel = await client.channels.fetch(CONFIG.CHANNELS.RAPPELS_PANEL);
                await channel.send({
                    content: `${msg}\n\n||<@&${CONFIG.ROLES.MEMBRE_1}>||`,
                    allowedMentions: { parse: ['roles'] },
                });
                await interaction.reply({ content: '✅ Rappel envoyé', ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: `❌ Erreur : ${err.message}`, ephemeral: true });
            }
            return true;
        }

        if (interaction.customId === 'modal_annonce_panel') {
            const msg = formatPanelMessage(interaction.fields.getTextInputValue('annonce_message'));
            try {
                const channel = await client.channels.fetch(CONFIG.CHANNELS.BM_NOTIF);
                await channel.send({
                    content: `${msg}\n\n||<@&${CONFIG.ROLES.MEMBRE_1}>||`,
                    allowedMentions: { parse: ['roles'] },
                });
                await interaction.reply({ content: '📢 Annonce envoyée', ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: `❌ Erreur : ${err.message}`, ephemeral: true });
            }
            return true;
        }

        if (interaction.customId === 'modal_sanction_panel') {
            const userId = interaction.fields.getTextInputValue('sanction_user');
            const raison = interaction.fields.getTextInputValue('sanction_raison');

            const cleanId = userId.replace(/[<@!>]/g, '').trim();
            const mention = /^\d{17,20}$/.test(cleanId) ? `<@${cleanId}>` : userId;

            try {
                const channel = await client.channels.fetch(CONFIG.CHANNELS.SANCTION);
                await channel.send(`${mention} Vous avez reçu un **avertissement** pour la raison suivante : ${raison} ${CONFIG.EMOJIS.ATTENTION} ${CONFIG.EMOJIS.BS21}`);
                emitRealtime('sanction:added', { userId: cleanId, raison });
                await interaction.reply({ content: '⚠️ Sanction envoyée', ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: `❌ Erreur : ${err.message}`, ephemeral: true });
            }
            return true;
        }

        if (interaction.customId === 'modal_programmer') {
            const msg = formatPanelMessage(interaction.fields.getTextInputValue('prog_message'));
            const intervalStr = interaction.fields.getTextInputValue('prog_interval').trim();
            const interval = [30, 60, 90, 120].includes(Number(intervalStr)) ? Number(intervalStr) : 60;

            const reminder = {
                id: nextReminderId++,
                message: msg,
                interval,
                enabled: true,
                lastMessageId: null,
                lastSentMinute: getElapsedMinutes(getParisMinutes()),
            };

            reminders.push(reminder);
            saveReminders();
            startReminderLoop();

            if (isInPanelTimeRange()) await sendReminderMessage(reminder);

            await interaction.reply({
                content: `⏰ Rappel #${reminder.id} programmé — **${interval} min** — 12h→03h`,
                ephemeral: true,
            });
            await refreshPanel();
            return true;
        }
        return false;
    }

    // ─── BOUTONS ──────────────────────────────────────
    if (!interaction.isButton()) return false;

    if (interaction.customId === 'btn_rappel') {
        const modal = new ModalBuilder().setCustomId('modal_rappel').setTitle('📌 Envoyer un rappel');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('rappel_message')
                    .setLabel('Message du rappel')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Utilise \\n pour les retours à la ligne')
                    .setRequired(true),
            ),
        );
        await interaction.showModal(modal);
        return true;
    }

    if (interaction.customId === 'btn_annonce') {
        const modal = new ModalBuilder().setCustomId('modal_annonce_panel').setTitle('📢 Envoyer une annonce');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('annonce_message')
                    .setLabel('Message de l\'annonce')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Utilise \\n pour les retours à la ligne')
                    .setRequired(true),
            ),
        );
        await interaction.showModal(modal);
        return true;
    }

    if (interaction.customId === 'btn_sanction') {
        const modal = new ModalBuilder().setCustomId('modal_sanction_panel').setTitle('⚠️ Sanctionner un joueur');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('sanction_user')
                    .setLabel('ID de l\'utilisateur')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Clic droit sur le joueur → Copier l\'identifiant')
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('sanction_raison')
                    .setLabel('Raison de la sanction')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true),
            ),
        );
        await interaction.showModal(modal);
        return true;
    }

    if (interaction.customId === 'btn_programmer') {
        const modal = new ModalBuilder().setCustomId('modal_programmer').setTitle('⏰ Programmer un rappel');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('prog_message')
                    .setLabel('Message du rappel')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Utilise \\n pour les retours à la ligne')
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('prog_interval')
                    .setLabel('Intervalle (30 / 60 / 90 / 120)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('60')
                    .setValue('60')
                    .setRequired(true)
                    .setMaxLength(3),
            ),
        );
        await interaction.showModal(modal);
        return true;
    }

    if (interaction.customId === 'btn_toggle') {
        const menu = buildReminderSelectMenu('select_toggle', 'Choisir un rappel à activer/désactiver');
        if (!menu) return interaction.reply({ content: '❌ Aucun rappel programmé', ephemeral: true });
        await interaction.reply({ content: '💤 Quel rappel veux-tu activer ou désactiver ?', components: [menu], ephemeral: true });
        return true;
    }

    if (interaction.customId === 'btn_delete_reminder') {
        const menu = buildReminderSelectMenu('select_delete', 'Choisir un rappel à supprimer');
        if (!menu) return interaction.reply({ content: '❌ Aucun rappel programmé', ephemeral: true });
        await interaction.reply({ content: '🗑️ Quel rappel veux-tu supprimer ?', components: [menu], ephemeral: true });
        return true;
    }

    return false;
}



    function hasEnabledReminders() {
        return reminders.some(reminder => reminder.enabled);
    }

    return {
        loadReminders,
        restorePanelState,
        startReminderLoop,
        stopReminderLoop,
        refreshPanel,
        handlePanel,
        handlePanelInteraction,
        hasEnabledReminders,
    };
}

module.exports = {
    createPanelService,
};
