// MODIFIÉ CHANTIER 6 — 14/05/2026 — création du client Discord isolée
const { Client, GatewayIntentBits, Partials } = require('discord.js');

function createDiscordClient() {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.MessageContent,
        ],
        partials: [
            Partials.Message,
            Partials.Reaction,
            Partials.User,
        ],
    });
}

module.exports = {
    createDiscordClient,
};
