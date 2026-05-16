// BOARD ARMES 17/05/2026 — slash refresh manuel board armes
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routeur interactions Discord isolé
const log = require('../../shared/logger');
const { audit } = require('../../shared/auditLog');
const { ADMIN_USER_ID } = require('../../shared/permissions');
const { refreshArmesBoard, BOARD_CHANNEL_ID } = require('../services/armesBoard');

function registerInteractionEvents(client, context) {
    const {
        CONFIG,
        handlePanelInteraction,
        handleSimpleAlert,
        handleRadio,
        handlePresenceTest,
        handlePresenceTest2,
        handlePresenceEdit,
        handleClear,
        handleClearMessage,
        handleAnnonce,
        handleAbsencePanel,
        handlePresence2,
        handlePresenceForce,
        handlePanel,
        handleClipsBackfill,
        handleClipsBackfillStatus,
    } = context;

    client.on('interactionCreate', async interaction => {
        if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
            if (!CONFIG.ROLES.COMMAND_ROLES.some(r => interaction.member?.roles.cache.has(r))) {
                return interaction.reply({ content: '❌ Pas la permission.', ephemeral: true });
            }
            const handled = await handlePanelInteraction(interaction);
            if (handled) return;
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        if (!CONFIG.ROLES.COMMAND_ROLES.some(r => interaction.member.roles.cache.has(r))) {
            return interaction.reply({ content: '❌ Pas la permission.', ephemeral: true });
        }

        const exempt = ['presence-test', 'presence-test2', 'clear', 'clearmessage', 'absence', 'presence-force', 'panel', 'clips-backfill', 'clips-backfill-status', 'board-armes-refresh'];
        if (!exempt.includes(interaction.commandName) && interaction.channelId !== CONFIG.CHANNELS.COMMANDES) {
            return interaction.reply({ content: `❌ Utilise <#${CONFIG.CHANNELS.COMMANDES}>`, ephemeral: true });
        }

        switch (interaction.commandName) {
            case 'qg': return handleSimpleAlert(interaction, `<@&${CONFIG.ROLES.MEMBRE_1}> 🚨 Rendez-vous au Hood ! Vous avez 5 minutes ! ${CONFIG.EMOJIS.BS21}`, true);
            case 'garage': return handleSimpleAlert(interaction, `🚨 Rendez-vous au Garage Hood ! Vous avez 5 minutes ! ${CONFIG.EMOJIS.BS21}`);
            case 'alignement': return handleSimpleAlert(interaction, `🚨 Merci de venir vous alignez ! Vous avez 3 minutes ! ${CONFIG.EMOJIS.BS21}`);
            case 'tir': return handleSimpleAlert(interaction, `🚨 Merci d'arrêter de tirer ! ${CONFIG.EMOJIS.BS21}`);
            case 'position': return handleSimpleAlert(interaction, `🚨 Merci de prendre des positions ! ${CONFIG.EMOJIS.BS21}`);
            case 'defense': return handleSimpleAlert(interaction, `<@&${CONFIG.ROLES.MEMBRE_1}> 🚨 Notre **laboratoire se fait attaquer** ! Tous au Hood dans 5 Minutes ! ${CONFIG.EMOJIS.BS21}`, true);
            case 'weed': return handleSimpleAlert(interaction, `🚨 On va aller sur la weed ! Branchez-vous sur la radio ! ${CONFIG.EMOJIS.BS21}`);
            case 'traitement-weed': return handleSimpleAlert(interaction, `🚨 On va aller sur le traitement de la weed ! Branchez-vous sur la radio ! ${CONFIG.EMOJIS.BS21}`);
            case 'yellowjack': return handleSimpleAlert(interaction, `<@&${CONFIG.ROLES.MEMBRE_1}> 🚨 Merci de venir à côté du Yellow Jack ${CONFIG.EMOJIS.BS21}`, true);
            case 'megamall': return handleSimpleAlert(interaction, `<@&${CONFIG.ROLES.MEMBRE_1}> 🚨 Merci de venir au parking Mega Mall ${CONFIG.EMOJIS.BS21}`, true);
            case 'parking5': return handleSimpleAlert(interaction, `<@&${CONFIG.ROLES.MEMBRE_1}> 🚨 Merci de vous rendre au Parking 5 (Madrazo) le plus rapidement possible.`, true);
            case 'ile': return handleSimpleAlert(interaction, `<@&${CONFIG.ROLES.MEMBRE_1}> 🚨 Merci de venir à côté de l'Ile ${CONFIG.EMOJIS.BS21}`, true);
            case 'trash': return handleSimpleAlert(interaction, `🚨 Celui qui trash sera ban sans sommation ! ${CONFIG.EMOJIS.BS21}`);
            case 'radio': return handleRadio(interaction);
            case 'presence-test': return handlePresenceTest(interaction);
            case 'presence-test2': return handlePresenceTest2(interaction);
            case 'presence-edit': return handlePresenceEdit(interaction);
            case 'clear': return handleClear(interaction);
            case 'clearmessage': return handleClearMessage(interaction);
            case 'annonce': return handleAnnonce(interaction);
            case 'absence': return handleAbsencePanel(interaction);
            case 'presence2': return handlePresence2(interaction);
            case 'presence-force': return handlePresenceForce(interaction);
            case 'panel': return handlePanel(interaction);
            case 'clips-backfill': return handleClipsBackfill(interaction);
            case 'clips-backfill-status': return handleClipsBackfillStatus(interaction);
            case 'board-armes-refresh': {
                if (interaction.user.id !== ADMIN_USER_ID) {
                    return interaction.reply({ content: '❌ Commande réservée à l’admin.', ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                try {
                    await refreshArmesBoard(client);
                    audit({ id: interaction.user.id, username: interaction.user.username }, 'board.armes.refresh.manual', {
                        target_type: 'discord_board',
                        target_id: BOARD_CHANNEL_ID,
                    });
                    return interaction.editReply('✅ Board armes rafraîchie.');
                } catch (e) {
                    log.warn({ err: e.message }, 'refresh board armes manuel échoué');
                    return interaction.editReply(`❌ Refresh impossible : ${e.message}`);
                }
            }
            default: return undefined;
        }
    });
}

module.exports = { registerInteractionEvents };
