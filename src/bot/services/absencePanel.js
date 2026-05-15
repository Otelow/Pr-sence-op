// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
// MODIFIÉ CHANTIER 6 — 14/05/2026 — service panneau absence externalisé

function createAbsencePanelService(deps) {
    const {
        client,
        sleep,
        loadState,
        saveState,
        deleteState,
        updateAbsenceSalonCache,
        buildAbsencePanelEmbeds,
        buildAbsencePanelPlaceholderEmbed,
    } = deps;

    const absencePanelData = {
        ids: [],
        channelId: null,
        busy: false,
        refreshInterval: null,
        createdAt: 0,
    };
    let absencePanelBusyTimeout = null;
    let absencePanelRefreshFailures = 0;
    let panelRefreshTimeout = null;

    function saveAbsencePanelState() {
        saveState('absence_panel', {
            ids: absencePanelData.ids || [],
            channelId: absencePanelData.channelId,
            createdAt: absencePanelData.createdAt || 0,
        });
    }

    function restoreAbsencePanelState() {
        const saved = loadState('absence_panel', null);
        if (!saved?.channelId || !Array.isArray(saved.ids) || saved.ids.length === 0) return;
        absencePanelData.ids = saved.ids;
        absencePanelData.channelId = saved.channelId;
        absencePanelData.createdAt = saved.createdAt || Date.now();
        startAbsencePanelRefresh();
        log.info(`📋 Panneau absence restauré (${saved.ids.length} message(s))`);
    }

    async function refreshAbsencePanel() {
        if (!absencePanelData.channelId || !absencePanelData.ids || absencePanelData.ids.length === 0) return;

        try {
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000));
            await Promise.race([updateAbsenceSalonCache(), timeout]).catch(() => {});

            const channel = client.channels.cache.get(absencePanelData.channelId);
            if (!channel) return;

            const embeds = buildAbsencePanelEmbeds();
            for (let i = 0; i < absencePanelData.ids.length; i++) {
                try {
                    const msg = await channel.messages.fetch(absencePanelData.ids[i]).catch(() => null);
                    if (!msg) continue;
                    if (i < embeds.length) {
                        await msg.edit({ embeds: [embeds[i]] }).catch(() => {});
                    }
                } catch {}
            }
            absencePanelRefreshFailures = 0;
        } catch (e) {
            absencePanelRefreshFailures += 1;
            log.error('⚠️ Refresh panneau erreur (non bloquant):', e.message);
            if (absencePanelRefreshFailures >= 3) {
                log.warn('⚠️ Refresh panneau absence stoppé après 3 échecs consécutifs');
                stopAbsencePanelRefresh();
            }
        }
    }

    function startAbsencePanelRefresh() {
        stopAbsencePanelRefresh();
        absencePanelRefreshFailures = 0;
        absencePanelData.refreshInterval = setInterval(() => refreshAbsencePanel(), 30_000);
    }

    function stopAbsencePanelRefresh() {
        if (absencePanelData.refreshInterval) {
            clearInterval(absencePanelData.refreshInterval);
            absencePanelData.refreshInterval = null;
        }
    }

    function scheduleAbsencePanelRefresh() {
        if (!absencePanelData.ids || absencePanelData.ids.length === 0) return;
        if (panelRefreshTimeout) clearTimeout(panelRefreshTimeout);
        panelRefreshTimeout = setTimeout(() => {
            refreshAbsencePanel();
            panelRefreshTimeout = null;
        }, 2_000);
    }

    function clearAbsencePanelState() {
        stopAbsencePanelRefresh();
        absencePanelData.ids = [];
        absencePanelData.channelId = null;
        absencePanelData.createdAt = 0;
        deleteState('absence_panel');
    }

    async function handleAbsencePanel(interaction) {
        if (absencePanelData.busy) {
            return interaction.reply({ content: '⏳ Le panneau /absence est déjà en cours de création. Réessaie dans quelques secondes.', ephemeral: true });
        }

        absencePanelData.busy = true;
        if (absencePanelBusyTimeout) clearTimeout(absencePanelBusyTimeout);
        absencePanelBusyTimeout = setTimeout(() => {
            absencePanelData.busy = false;
            log.warn('⚠️ Lock /absence libéré automatiquement après 30s');
        }, 30_000);

        try {
            await interaction.deferReply();
        } catch (e) {
            absencePanelData.busy = false;
            if (absencePanelBusyTimeout) clearTimeout(absencePanelBusyTimeout);
            log.error('❌ /absence defer erreur:', e.message);
            return;
        }

        const channel = interaction.channel;
        const oldIds = [...(absencePanelData.ids || [])];
        const oldChannelId = absencePanelData.channelId;
        stopAbsencePanelRefresh();
        absencePanelData.ids = [];
        absencePanelData.channelId = channel.id;
        absencePanelData.createdAt = Date.now();
        saveAbsencePanelState();

        if (oldIds.length && oldChannelId) {
            const oldChannel = client.channels.cache.get(oldChannelId);
            if (oldChannel) {
                for (const id of oldIds) {
                    oldChannel.messages.fetch(id).then(msg => msg.delete()).catch(() => {});
                }
            }
        }

        try {
            const placeholderTotal = 5;
            await interaction.editReply({ embeds: [buildAbsencePanelPlaceholderEmbed(1, placeholderTotal)] });
            const firstMsg = await interaction.fetchReply().catch(() => null);
            if (firstMsg) {
                absencePanelData.ids.push(firstMsg.id);
                saveAbsencePanelState();
            }

            const placeholderMessages = firstMsg ? [firstMsg] : [];
            for (let i = 1; i < placeholderTotal; i++) {
                const msg = await channel.send({ embeds: [buildAbsencePanelPlaceholderEmbed(i + 1, placeholderTotal)] });
                placeholderMessages.push(msg);
                absencePanelData.ids.push(msg.id);
                saveAbsencePanelState();
                await sleep(200);
            }

            await updateAbsenceSalonCache({ force: true });
            const embeds = buildAbsencePanelEmbeds();
            for (let i = 0; i < placeholderMessages.length; i++) {
                if (!placeholderMessages[i]) continue;
                if (embeds[i]) {
                    await placeholderMessages[i].edit({ embeds: [embeds[i]] }).catch(() => {});
                } else {
                    await placeholderMessages[i].delete().catch(() => {});
                    absencePanelData.ids = absencePanelData.ids.filter(id => id !== placeholderMessages[i].id);
                    saveAbsencePanelState();
                }
            }

            startAbsencePanelRefresh();
            await interaction.followUp({ content: '✅ Panneau absence prêt.', ephemeral: true }).catch(() => {});
        } catch (e) {
            log.error('❌ Erreur /absence:', e.message);
            await interaction.editReply({ content: '❌ Impossible de créer le panneau absence. Réessaie dans quelques secondes.', embeds: [] }).catch(() => {});
        } finally {
            absencePanelData.busy = false;
            if (absencePanelBusyTimeout) {
                clearTimeout(absencePanelBusyTimeout);
                absencePanelBusyTimeout = null;
            }
            updateAbsenceSalonCache({ force: true }).catch(() => {});
        }
    }

    return {
        restoreAbsencePanelState,
        refreshAbsencePanel,
        startAbsencePanelRefresh,
        stopAbsencePanelRefresh,
        scheduleAbsencePanelRefresh,
        clearAbsencePanelState,
        handleAbsencePanel,
        getAbsencePanelData: () => absencePanelData,
    };
}

module.exports = {
    createAbsencePanelService,
};
