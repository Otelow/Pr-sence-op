// MODIFIÉ CHANTIER 6 — 14/05/2026 — handlers slash présence isolés

function createPresenceCommandHandlers(deps) {
    const {
        CONFIG,
        getPresenceData,
        setPresenceData,
        getPresence2Data,
        setPresence2Data,
        reactionsOP1,
        reactionsOP2,
        getPresenceItems,
        setPresenceItems,
        savePresenceState,
        sendPresenceMessage,
        sendPresence2Message,
    } = deps;

    async function handlePresenceForce(interaction) {
        if (getPresenceData().active) {
            return interaction.reply({ content: '⚠️ Une présence OP est déjà active. Utilise `/presence-test` pour relancer.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply('🔄 Lancement forcé de la présence OP...');

        await sendPresenceMessage();
        await interaction.editReply('✅ Présence OP lancée.');

        console.log('🔄 /presence-force: Présence OP lancée manuellement');
    }

    async function handlePresence2(interaction) {
        await interaction.reply({ content: '📋 Envoi de la 2ème présence OP...', ephemeral: true });
        await sendPresence2Message();
    }

    async function handlePresenceTest2(interaction) {
        setPresence2Data({ messageId: null, active: false });
        reactionsOP2.clear();
        savePresenceState();
        await interaction.reply({ content: '🧪 Test 2ème présence OP...', ephemeral: true });
        await sendPresence2Message(CONFIG.CHANNELS.COMMANDES);
    }

    async function handlePresenceTest(interaction) {
        const currentPresence = getPresenceData();
        if (currentPresence.reminderInterval) clearInterval(currentPresence.reminderInterval);
        setPresenceData({ messageId: null, reminderIds: [], reminderInterval: null, active: false });
        reactionsOP1.clear();
        savePresenceState();
        await interaction.reply({ content: '🧪 Test 1ère présence OP...', ephemeral: true });
        await sendPresenceMessage(CONFIG.CHANNELS.COMMANDES);
    }

    async function handlePresenceEdit(interaction) {
        const liste = interaction.options.getString('liste');
        if (!liste) {
            const currentItems = getPresenceItems();
            return interaction.reply({
                content: `📋 **Liste :**\n${currentItems.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
                ephemeral: true,
            });
        }

        const items = liste.split('/').map(item => item.trim()).filter(Boolean);
        if (!items.length) return interaction.reply({ content: '❌ Vide.', ephemeral: true });
        setPresenceItems(items);
        await interaction.reply({
            content: `✅ Mis à jour !\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
            ephemeral: true,
        });
    }

    return {
        handlePresenceForce,
        handlePresence2,
        handlePresenceTest2,
        handlePresenceTest,
        handlePresenceEdit,
    };
}

module.exports = {
    createPresenceCommandHandlers,
};
