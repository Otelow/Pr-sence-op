// MODIFIE CHANTIER 6 - 14/05/2026 - enregistrement slash commands externalise

const { REST, Routes } = require('discord.js');

function createCommandRegistrationService(deps) {
    const {
        CONFIG,
        client,
        buildSlashCommands,
    } = deps;

    async function registerCommands() {
        const commands = buildSlashCommands();

        const rest = new REST().setToken(CONFIG.TOKEN);
        try {
            await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), { body: commands.map(command => command.toJSON()) });
            console.log('✅ Commandes enregistrées');
        } catch (error) {
            console.error('❌ Erreur commandes:', error);
        }
    }

    return {
        registerCommands,
    };
}

module.exports = {
    createCommandRegistrationService,
};
