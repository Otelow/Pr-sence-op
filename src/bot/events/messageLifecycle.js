// MODIFIÉ CHANTIER 6 — 14/05/2026 — events message lifecycle isolés
function registerMessageLifecycleEvents(client, context) {
    const {
        handleAbsenceSalonCacheEvent,
        presenceData,
        presence2Data,
    } = context;

    client.on('messageCreate', message => {
        handleAbsenceSalonCacheEvent(message, 'messageCreate');
    });

    client.on('messageDelete', message => {
        handleAbsenceSalonCacheEvent(message, 'messageDelete');
    });

    client.on('messageUpdate', (oldMessage, newMessage) => {
        handleAbsenceSalonCacheEvent(newMessage || oldMessage, 'messageUpdate');
    });

    client.on('messageDelete', async message => {
        if (presence2Data.messageId === message.id) {
            console.log('🗑️ Message 2ème OP supprimé sur Discord, mais panel site conservé jusqu\'à 2h');
        }
        if (presenceData.messageId === message.id) {
            console.log('🗑️ Message 1ère OP supprimé sur Discord, mais panel site conservé jusqu\'à 2h');
        }
    });
}

module.exports = { registerMessageLifecycleEvents };
