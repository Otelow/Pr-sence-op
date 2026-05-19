// HISTORIQUE PRÉSENCE 19/05/2026 — persistance + 7 jours
// FIX PRÉSENCE 18/05/2026 — 3 bugs classification corrigés
// QUICK WINS 5 18/05/2026 — cron stats hebdomadaires Discord
// BOARD ARMES 17/05/2026 — init board armes live Discord
// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../shared/logger');
// FINAL POST-STAB G 17/05/2026 — alerte webhook fatale bot
const { alertDiscordError } = require('../shared/alertWebhook');
// STABILISATION 15/05/2026 — corrections runtime post-audit
// ==========================================
// 21 Block Savage - Discord Bot
// MODIFIÉ CHANTIER 1 — 14/05/2026 — stabilisation /absence, lock panneau et cache salon
// MODIFIÉ CHANTIER 4 — 14/05/2026 — salons et rôles Discord centralisés
// MODIFIÉ CHANTIER 7 — 14/05/2026 — persistance SQLite panel/absence
// MODIFIÉ CHANTIER 8 — 14/05/2026 — rappels panel sans drift modulo
// MODIFIÉ CHANTIER 9 — 14/05/2026 — réactions et interactions longues optimisées
// MODIFIÉ CHANTIER 10 — 14/05/2026 — crash fatal relancé par Railway
// MODIFIÉ CHANTIER 11 — 14/05/2026 — backups journaliers programmés
// MODIFIÉ CHANTIER 12 — 14/05/2026 — events temps réel dashboard
// MODIFIÉ CHANTIER 6 — 14/05/2026 — client Discord et slash commands externalisés
// MODIFIÉ CHANTIER 7 — 14/05/2026 — suivi absences/rappels migrés dans bot_state
// MODIFIÉ CHANTIER 6 — 14/05/2026 — events réactions présence externalisés
// MODIFIÉ CHANTIER 6 — 14/05/2026 — events message lifecycle externalisés
// MODIFIÉ CHANTIER 6 — 14/05/2026 — messageCreate BM/!presence externalisé
// MODIFIÉ CHANTIER 6 — 14/05/2026 — events clips/absence externalisés
// MODIFIÉ CHANTIER 6 — 14/05/2026 — utils sleep/safeReact externalisés
// MODIFIÉ CHANTIER 6 — 14/05/2026 — routeur interactions externalisé
// MODIFIÉ CHANTIER 6 — 14/05/2026 — service accueil Discord externalisé
// MODIFIÉ CHANTIER 6 — 14/05/2026 — commandes clips externalisées
// MODIFIÉ CHANTIER 6 — 14/05/2026 — commandes utilitaires externalisées
// MODIFIÉ CHANTIER 6 — 14/05/2026 — handlers slash présence externalisés
// MODIFIÉ CHANTIER 6 — 14/05/2026 — service panel/rappels externalisé
// MODIFIÉ CHANTIER 6 — 14/05/2026 — service panneau absence externalisé
// MODIFIE CHANTIER 6 - 14/05/2026 - cache/embeds panneau presence externalises
// MODIFIE HOTFIX RAILWAY - 14/05/2026 - mapping reactions presence restaure
// ==========================================
// Nécessite: npm install discord.js node-cron
// Lancer: node bot.js
// ==========================================

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const config = require('../shared/config');
const { GUILD_ID, CHANNELS, ROLES } = require('../shared/channels');
const { createDiscordClient } = require('./client');
const { buildSlashCommands } = require('./commands/definitions');
const { createCommandRegistrationService } = require('./commands/register');
const { createClipCommandHandlers } = require('./commands/clips');
const { createUtilityCommandHandlers } = require('./commands/utility');
const { createPresenceCommandHandlers } = require('./commands/presence');
const { registerPresenceReactionEvents } = require('./events/presenceReactions');
const { registerMessageLifecycleEvents } = require('./events/messageLifecycle');
const { registerMessageCommandEvents } = require('./events/messageCommands');
const { registerClipEvents } = require('./events/clips');
const { registerAbsenceValidatorEvent } = require('./events/absenceValidator');
const { registerInteractionEvents } = require('./events/interactions');
const { registerReadyEvent } = require('./events/ready');
const { registerGuildMemberEvents } = require('./events/guildMembers');
const { sleep } = require('./utils/sleep');
const { safeReact, addPresenceReactions } = require('./utils/safeReact');
const { scheduleDailyBackups } = require('./services/backup');
const { initArmesBoard } = require('./services/armesBoard');
const { scheduleWeeklyStats } = require('./services/weeklyStats');
const { loadState, saveState, deleteState } = require('./services/state');
const { createWelcomeService } = require('./services/welcome');
const { createWelcomeStatePersistence } = require('./services/welcomeState');
const { createAbsenceTrackingPersistence } = require('./services/absenceTracking');
const { createPresenceStatePersistence } = require('./services/presenceState');
const { createReactionRestoreService } = require('./services/reactionRestore');
const { createPanelService } = require('./services/panel');
const { createPresencePanelService } = require('./services/presencePanel');
const { createPresenceFlowService } = require('./services/presenceFlow');
const { createAbsencePanelService } = require('./services/absencePanel');
const { emitRealtime } = require('../shared/realtime');
const { backfillClipForum, getBackfillStatus } = require('../shared/clipBackup');

fs.mkdirSync(config.paths.data, { recursive: true });

function dataFile(name) {
    return path.join(config.paths.data, name);
}

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN,
    GUILD_ID,
    CHANNELS,
    ROLES,

    VIP_USERS: [
        '293050500482465793',
        '1068904345191600128',
        '210331081180839939',
        '1358060794000183348',
        '1260991191739269130',
        '1375511683472035890',
        '952986899667103804',
    ],

    // Mapping userID → roleID à attribuer automatiquement (et à maintenir en permanence)
    AUTO_ROLE_USERS: {
        '952986899667103804': '1485279148246175764',
    },

    EMOJIS: {
        CHECK: '<a:check:1486393925219647519>',
        RETARD: '<:retard1:1486400147654049924>',
        NO: '<a:no:1486417914084069507>',
        ATTENTION: '<a:attention:1486396212398526545>',
        BS21: '<:21bs:1487618400443306055>',
        BM: '<:bm:1489337087282118686>',
        LSPD: '<:lspd:1495451609084334220>',
    },

    REACT_EMOJIS: {
        CHECK: 'check:1486393925219647519',
        RETARD: 'retard1:1486400147654049924',
        NO: 'no:1486417914084069507',
        BM: 'bm:1489337087282118686',
        LSPD: 'lspd:1495451609084334220',
    },
};

function emojiToType(name, id) {
    const key = id ? `${name}:${id}` : String(name || '');
    if (key === CONFIG.REACT_EMOJIS.CHECK || name === '✅') return 'check';
    if (key === CONFIG.REACT_EMOJIS.RETARD || name === '⏰') return 'retard';
    if (key === CONFIG.REACT_EMOJIS.NO || name === '❌') return 'no';
    return null;
}

// ==========================================
// MODE TEST
// ==========================================
const TEST_MODE = false;
const TURBO_MODE = false;
const PRESENCE_ENABLED = true;

const TIMERS = {
    QG_DELETE_DELAY: TURBO_MODE ? 5_000 : TEST_MODE ? 10_000 : 120_000,
    QG_MESSAGE_INTERVAL: TEST_MODE ? 200 : 500,
    REMINDER_DELETE_DELAY: TURBO_MODE ? 3_000 : TEST_MODE ? 5_000 : 120_000,
    PRESENCE_RAPPEL_INTERVAL: TURBO_MODE ? 8_000 : TEST_MODE ? 15_000 : 1_800_000,
};

const PRESENCE_CRON = (TEST_MODE || TURBO_MODE) ? '* * * * *' : '30 17 * * *';

if (TURBO_MODE) {
    log.info('🚀 MODE TURBO ACTIVÉ');
} else if (TEST_MODE) {
    log.info('🧪 MODE TEST ACTIVÉ');
}

// ==========================================
// CLIENT DISCORD
// ==========================================
const client = createDiscordClient();

let startWelcomeFlow;
let restoreRenameChecks;
let handleClipsBackfill;
let handleClipsBackfillStatus;
let handleSimpleAlert;
let handleRadio;
let handleAnnonce;
let handleClear;
let handleClearMessage;
let handlePresenceForce;
let handlePresence2;
let handlePresenceTest2;
let handlePresenceTest;
let handlePresenceEdit;
let loadReminders;
let restorePanelState;
let startReminderLoop;
let stopReminderLoop;
let refreshPanel;
let handlePanel;
let handlePanelInteraction;
let hasEnabledReminders;
let restoreAbsencePanelState;
let refreshAbsencePanel;
let startAbsencePanelRefresh;
let stopAbsencePanelRefresh;
let scheduleAbsencePanelRefresh;
let clearAbsencePanelState;
let handleAbsencePanel;
let updateAbsenceSalonCache;
let scheduleAbsenceSalonCacheUpdate;
let handleAbsenceSalonCacheEvent;
let buildAbsencePanelEmbeds;
let buildAbsencePanelPlaceholderEmbed;
let getConsecutiveDays;
let getAbsenceSalonCache;
let setupPresenceCron;
let sendPresence2Message;
let sendPresenceMessage;
let startPresenceReminders;
let getAbsentUsersToday;
let getParisDateKey;
let snapshotPresenceDay;

// ==========================================
// STOCKAGE EN MÉMOIRE
// ==========================================
const welcomeState = new Map();
const WELCOME_KICK_DELAY = 5 * 60 * 1000;
const renameCheckState = new Map();
const RENAME_KICK_DELAY = 10 * 60 * 1000;
let lastRadioMessageId = null;

// Persistance du welcomeState pour survivre aux redéploiements
const WELCOME_STATE_FILE = dataFile('welcome_state.json');

const savedRenameChecks = loadState('rename_check', {});
if (savedRenameChecks && typeof savedRenameChecks === 'object') {
    for (const [userId, renameState] of Object.entries(savedRenameChecks)) {
        if (renameState && typeof renameState === 'object') {
            renameCheckState.set(userId, renameState);
        }
    }
}

function saveRenameCheckState(userId, renameState) {
    const all = loadState('rename_check', {}) || {};
    all[userId] = renameState;
    saveState('rename_check', all);
}

function deleteRenameCheckState(userId) {
    const all = loadState('rename_check', {}) || {};
    delete all[userId];
    saveState('rename_check', all);
}

function hasProtectedRole(member) {
    return CONFIG.ROLES.PROTECTED_ROLES.some(roleId => member.roles.cache.has(roleId));
}


const {
    saveWelcomeState,
    loadWelcomeStateData,
    deleteWelcomeState,
} = createWelcomeStatePersistence({
    fs,
    welcomeStateFile: WELCOME_STATE_FILE,
    welcomeState,
    loadState,
    saveState,
});

({
    startWelcomeFlow,
    restoreRenameChecks,
} = createWelcomeService({
    CONFIG,
    client,
    welcomeState,
    renameCheckState,
    welcomeKickDelay: WELCOME_KICK_DELAY,
    renameKickDelay: RENAME_KICK_DELAY,
    safeReact,
    sleep,
    saveWelcomeState,
    deleteWelcomeState,
    saveRenameCheckState,
    deleteRenameCheckState,
}));

({
    handleClipsBackfill,
    handleClipsBackfillStatus,
} = createClipCommandHandlers({
    client,
    backfillClipForum,
    getBackfillStatus,
}));

({
    handleSimpleAlert,
    handleRadio,
    handleAnnonce,
    handleClear,
    handleClearMessage,
} = createUtilityCommandHandlers({
    CONFIG,
    TIMERS,
    client,
    sleep,
    setLastRadioMessageId: value => {
        lastRadioMessageId = value;
    },
}));

let presenceItems = [
    'Armes, munitions',
    'Eau, nourriture',
    'Pochons d\'opium',
    'Véhicule prêt (Etat, Essence ok)',
];

let customPresenceMessage = null;

// Suivi des absences hebdomadaire (persistant via volume, reset dimanche 22h)
// Map<userId, { count, dates[], username }>
const TRACKING_FILE = dataFile('absence_tracking.json');

const {
    loadAbsenceTracking,
    saveAbsenceTracking,
} = createAbsenceTrackingPersistence({
    fs,
    trackingFile: TRACKING_FILE,
    loadState,
    saveState,
    emitRealtime,
    getAbsenceTracking: () => absenceTracking,
});

const absenceTracking = loadAbsenceTracking();
log.info(`📊 Suivi absences chargé: ${absenceTracking.size} utilisateur(s)`);

// 1ère Présence OP
let presenceData = {
    messageId: null,
    reminderIds: [],
    reminderInterval: null,
    active: false,
};

// 2ème Présence OP
let presence2Data = {
    messageId: null,
    active: false,
};

const reactionsOP1 = new Map(); // Map<userId, Set<reactionType>>
const reactionsOP2 = new Map(); // Map<userId, Set<reactionType>>

function getReactionMap(messageId) {
    if (presenceData.messageId === messageId) return reactionsOP1;
    if (presence2Data.messageId === messageId) return reactionsOP2;
    return null;
}

function getPresenceOpForMessageId(messageId) {
    if (presenceData.messageId === messageId) return 'op1';
    if (presence2Data.messageId === messageId) return 'op2';
    return null;
}

// ==========================================
// PERSISTANCE ÉTAT PRÉSENCE (survie redéploiement)
// ==========================================
const STATE_FILE = dataFile('presence_state.json');

const {
    savePresenceState,
    loadPresenceState,
    getParisDateKey: getPresenceParisDateKey,
    snapshotPresenceDay: snapshotPresenceDayForHistory,
} = createPresenceStatePersistence({
    fs,
    stateFile: STATE_FILE,
    CONFIG,
    client,
    reactionsOP1,
    reactionsOP2,
    getPresenceData: () => presenceData,
    getPresence2Data: () => presence2Data,
    getAbsentUsersToday: targetDate => getAbsentUsersToday(targetDate),
});
getParisDateKey = getPresenceParisDateKey;
snapshotPresenceDay = snapshotPresenceDayForHistory;

// Restaurer les réactions depuis le message Discord (une seule fois au boot)
const { restoreReactionsFromMessage } = createReactionRestoreService({
    CONFIG,
    client,
    emojiToType,
});

({
    setupPresenceCron,
    sendPresence2Message,
    sendPresenceMessage,
    startPresenceReminders,
    getAbsentUsersToday,
} = createPresenceFlowService({
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
    getPresenceData: () => presenceData,
    setPresenceData: value => {
        presenceData = value;
    },
    getPresence2Data: () => presence2Data,
    setPresence2Data: value => {
        presence2Data = value;
    },
    getPresenceItems: () => presenceItems,
    getCustomPresenceMessage: () => customPresenceMessage,
    getAbsenceTracking: () => absenceTracking,
    loadState,
    saveState,
    savePresenceState,
    snapshotPresenceDay,
    getParisDateKey,
    saveAbsenceTracking,
    refreshAbsencePanel: () => refreshAbsencePanel(),
    stopAbsencePanelRefresh: () => stopAbsencePanelRefresh(),
    clearAbsencePanelState: () => clearAbsencePanelState(),
    getConsecutiveDays: data => getConsecutiveDays(data),
}));

({
    handlePresenceForce,
    handlePresence2,
    handlePresenceTest2,
    handlePresenceTest,
    handlePresenceEdit,
} = createPresenceCommandHandlers({
    CONFIG,
    getPresenceData: () => presenceData,
    setPresenceData: value => {
        presenceData = value;
    },
    getPresence2Data: () => presence2Data,
    setPresence2Data: value => {
        presence2Data = value;
    },
    reactionsOP1,
    reactionsOP2,
    getPresenceItems: () => presenceItems,
    setPresenceItems: value => {
        presenceItems = value;
    },
    savePresenceState,
    sendPresenceMessage,
    sendPresence2Message,
}));

({
    updateAbsenceSalonCache,
    scheduleAbsenceSalonCacheUpdate,
    handleAbsenceSalonCacheEvent,
    buildAbsencePanelEmbeds,
    buildAbsencePanelPlaceholderEmbed,
    getConsecutiveDays,
    getAbsenceSalonCache,
} = createPresencePanelService({
    CONFIG,
    client,
    getPresenceData: () => presenceData,
    getPresence2Data: () => presence2Data,
    reactionsOP1,
    reactionsOP2,
    getAbsenceTracking: () => absenceTracking,
    getAbsentUsersToday,
    refreshAbsencePanel: () => refreshAbsencePanel(),
}));

({
    restoreAbsencePanelState,
    refreshAbsencePanel,
    startAbsencePanelRefresh,
    stopAbsencePanelRefresh,
    scheduleAbsencePanelRefresh,
    clearAbsencePanelState,
    handleAbsencePanel,
} = createAbsencePanelService({
    client,
    sleep,
    loadState,
    saveState,
    deleteState,
    updateAbsenceSalonCache,
    buildAbsencePanelEmbeds,
    buildAbsencePanelPlaceholderEmbed,
}));

({
    loadReminders,
    restorePanelState,
    startReminderLoop,
    stopReminderLoop,
    refreshPanel,
    handlePanel,
    handlePanelInteraction,
    hasEnabledReminders,
} = createPanelService({
    client,
    CONFIG,
    remindersFile: dataFile('reminders.json'),
    loadState,
    saveState,
    deleteState,
    emitRealtime,
}));

// ==========================================
// ENREGISTREMENT COMMANDES
// ==========================================
const { registerCommands } = createCommandRegistrationService({
    CONFIG,
    client,
    buildSlashCommands,
});

// ==========================================
// BOT PRÊT
// ==========================================
registerReadyEvent({
    client,
    CONFIG,
    cron,
    TURBO_MODE,
    registerCommands,
    setupPresenceCron,
    scheduleDailyBackups,
    scheduleWeeklyStats,
    initArmesBoard,
    restoreAbsencePanelState,
    restoreRenameChecks,
    loadReminders,
    restorePanelState,
    hasEnabledReminders,
    startReminderLoop,
    updateAbsenceSalonCache,
    loadPresenceState,
    restoreReactionsFromMessage,
    reactionsOP1,
    reactionsOP2,
    presenceData,
    presence2Data,
    savePresenceState,
    startPresenceReminders,
    absenceTracking,
    saveAbsenceTracking,
    sendPresenceMessage,
});

registerGuildMemberEvents(client,
{
    CONFIG,
    hasProtectedRole,
    startWelcomeFlow,
});

registerMessageLifecycleEvents(client, {
    handleAbsenceSalonCacheEvent,
    presenceData,
    presence2Data,
});

registerPresenceReactionEvents(client, {
    getReactionMap,
    emojiToType,
    getPresenceOpForMessageId,
    scheduleAbsencePanelRefresh,
});

registerInteractionEvents(client, {
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
});

// ==========================================
// FLUX PRESENCE OP externalise dans src/bot/services/presenceFlow.js
// ==========================================

registerClipEvents(client);
registerAbsenceValidatorEvent(client, { CONFIG, scheduleAbsenceSalonCacheUpdate });

// ==========================================
// ERREURS
// ==========================================
process.on('unhandledRejection', e => {
    log.warn('⚠️ Unhandled Rejection:', e?.stack || e);
});
process.on('uncaughtException', e => {
    log.error('❌ Uncaught Exception (fatal):', e);
    alertDiscordError('Bot uncaughtException', e).finally(() => process.exit(1));
});

// ==========================================
// LANCEMENT
// ==========================================
client.login(CONFIG.TOKEN);

// ==========================================
// EXPORTS pour le serveur web
// ==========================================
function getBotState() {
    return {
        CONFIG,
        presenceData,
        presence2Data,
        reactionsOP1,
        reactionsOP2,
        absenceTracking,
        absenceSalonCache: getAbsenceSalonCache(),
        sendPresenceMessage,
        sendPresence2Message,
        getAbsentUsersToday,
        updateAbsenceSalonCache,
        getConsecutiveDays,
        saveAbsenceTracking,
    };
}

module.exports = { client, getBotState };
