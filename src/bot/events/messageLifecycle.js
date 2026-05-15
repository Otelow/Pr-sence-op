// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
// STABILISATION 15/05/2026 — realtime salons sur nouveaux messages
// MODIFIE CHANTIER 6 - 14/05/2026 - events message lifecycle isoles
const { emitRealtime } = require('../../shared/realtime');

function registerMessageLifecycleEvents(client, context) {
    const {
        handleAbsenceSalonCacheEvent,
        presenceData,
        presence2Data,
    } = context;

    client.on('messageCreate', message => {
        handleAbsenceSalonCacheEvent(message, 'messageCreate');
        if (!message.author?.bot) {
            emitRealtime('channel:message', { channelId: message.channelId });
        }
    });

    client.on('messageDelete', message => {
        handleAbsenceSalonCacheEvent(message, 'messageDelete');
    });

    client.on('messageUpdate', (oldMessage, newMessage) => {
        handleAbsenceSalonCacheEvent(newMessage || oldMessage, 'messageUpdate');
    });

    client.on('messageDelete', async message => {
        if (presence2Data.messageId === message.id) {
            log.info('🗑️ Message 2eme OP supprime sur Discord, mais panel site conserve jusqu a 2h');
        }
        if (presenceData.messageId === message.id) {
            log.info('🗑️ Message 1ere OP supprime sur Discord, mais panel site conserve jusqu a 2h');
        }
    });
}

module.exports = { registerMessageLifecycleEvents };
