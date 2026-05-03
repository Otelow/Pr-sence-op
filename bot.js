// ==========================================
// 21 Block Savage - Discord Bot
// ==========================================
// Nécessite: npm install discord.js node-cron
// Lancer: node bot.js
// ==========================================

const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');

// Helper sleep utilisé partout dans le code
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN || 'MTQ4NTI2ODY5NzUyMTA2NTk5NA.G-ZutD.dJCX8T7nszQaXqMgnoHXfbC6oqJu2L6oURe0Vc',
    GUILD_ID: process.env.GUILD_ID || '1485254310894895282',

    CHANNELS: {
        REGLEMENT: '1485288718225903676',
        COMMANDES: '1485624499234934857',
        QG: '1485651067860680915',
        RADIO: '1488490323398099014',
        PRESENCE: '1485270858980135004',
        ABSENCE: '1485623724622217316',
        SANCTION: '1488548984955080735',
        AVERTISSEMENT: '1490345122678837419',
        BM_ANNONCES: '1485636616683913346',
        BM_NOTIF: '1485636555480502404',
        RAPPELS_PANEL: '1485669809956982984',
        CLIPS: '1485624000569933905',
    },

    ROLES: {
        MEMBRE_1: '1485270431291277383',
        MEMBRE_2: '1485636099853516982',
        MEMBRE_3: '1485279821658456306',
        EXCLUDED_ROLE: '1485279148246175764',
        EXCLUDED_RENAME: '1489336767097208922',
        VIP_ROLE: '1489336767097208922',
        ALERT_ROLE: '1490361524408291459',
        // Rôles protégés : pas de kick, pas de relance accueil, pas d'exclusion
        PROTECTED_ROLES: [
            '1489336767097208922',
            '1495448653945634987',
            '1495464200443662366',
            '1497005826114846741',
            '1497228404834045972',
        ],
        // Rôles supérieurs : si MEMBRE_3 retiré et remplacé par un de ceux-là dans les 5 min → promotion (pas de relance accueil)
        PROMOTION_ROLES: [
            '1485279789253132288',
            '1485279738212651279',
            '1485279571531137204',
            '1485279534650494976',
        ],
        COMMAND_ROLES: [
            '1485279148246175764',
            '1486744891848654988',
            '1485279534650494976',
            '1485279571531137204',
        ],
    },

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
    console.log('🚀 MODE TURBO ACTIVÉ');
} else if (TEST_MODE) {
    console.log('🧪 MODE TEST ACTIVÉ');
}

// ==========================================
// CLIENT DISCORD
// ==========================================
const client = new Client({
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

// ==========================================
// STOCKAGE EN MÉMOIRE
// ==========================================
const welcomeState = new Map();
const WELCOME_KICK_DELAY = 5 * 60 * 1000;
const renameCheckState = new Map();
const RENAME_KICK_DELAY = 10 * 60 * 1000;
const roleRemovalProcessing = new Set();
const pendingPromotionChecks = new Map(); // userId → timer pour grace period 5min après retrait MEMBRE_3
let lastRadioMessageId = null;
const botStartTime = Date.now(); // Pour le fallback welcome : ne traiter que les messages antérieurs au démarrage

// Persistance du welcomeState pour survivre aux redéploiements
const WELCOME_STATE_FILE = '/data/welcome_state.json';

function saveWelcomeState() {
    try {
        const data = {};
        for (const [userId, state] of welcomeState) {
            // On sauve uniquement ce qui peut être restauré (pas les timers)
            data[userId] = {
                step: state.step,
                messageId: state.messageId,
                guildId: state.guildId,
                createdAt: state.createdAt || Date.now(),
            };
        }
        fs.writeFileSync(WELCOME_STATE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('❌ Erreur sauvegarde welcome:', e.message);
    }
}

function loadWelcomeStateData() {
    try {
        if (fs.existsSync(WELCOME_STATE_FILE)) {
            return JSON.parse(fs.readFileSync(WELCOME_STATE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('❌ Erreur chargement welcome:', e.message);
    }
    return {};
}

function deleteWelcomeState(userId) {
    welcomeState.delete(userId);
    saveWelcomeState();
}

let presenceItems = [
    'Armes, munitions',
    'Eau, nourriture',
    'Pochons d\'opium',
    'Véhicule prêt (Etat, Essence ok)',
];

let customPresenceMessage = null;

// Suivi des absences hebdomadaire (persistant via volume, reset dimanche 22h)
// Map<userId, { count, dates[], username }>
const TRACKING_FILE = '/data/absence_tracking.json';

function loadAbsenceTracking() {
    try {
        if (fs.existsSync(TRACKING_FILE)) {
            const data = JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf8'));
            return new Map(Object.entries(data));
        }
    } catch (e) {
        console.error('❌ Erreur chargement suivi absences:', e);
    }
    return new Map();
}

function saveAbsenceTracking() {
    try {
        const data = {};
        for (const [key, value] of absenceTracking) {
            data[key] = value;
        }
        fs.writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('❌ Erreur sauvegarde suivi absences:', e);
    }
}

const absenceTracking = loadAbsenceTracking();
console.log(`📊 Suivi absences chargé: ${absenceTracking.size} utilisateur(s)`);

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

// Panneau /absence
let absencePanelData = {
    messageId: null,
    messageIds: [],
    channelId: null,
    refreshInterval: null,
};

// ==========================================
// PERSISTANCE ÉTAT PRÉSENCE (survie redéploiement)
// ==========================================
const STATE_FILE = '/data/presence_state.json';

function savePresenceState() {
    try {
        const state = {
            op1: { messageId: presenceData.messageId, active: presenceData.active },
            op2: { messageId: presence2Data.messageId, active: presence2Data.active },
            savedAt: new Date().toISOString(),
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        console.error('❌ Erreur sauvegarde état présence:', e.message);
    }
}

function loadPresenceState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            console.log(`📋 État présence chargé (sauvé à ${state.savedAt})`);
            return state;
        }
    } catch (e) {
        console.error('❌ Erreur chargement état présence:', e.message);
    }
    return null;
}

function clearPresenceState() {
    try {
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    } catch {}
}

// Restaurer les réactions depuis le message Discord (une seule fois au boot)
async function restoreReactionsFromMessage(messageId, reactionMap) {
    try {
        const channel = client.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
        if (!channel) return false;

        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (!msg) return false;

        reactionMap.clear();
        for (const [, reaction] of msg.reactions.cache) {
            const emojiKey = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
            const users = await reaction.users.fetch();
            for (const [userId, user] of users) {
                if (user.bot) continue;
                const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
                if (type) reactionMap.set(userId, type);
            }
        }
        console.log(`   ↳ ${reactionMap.size} réaction(s) restaurées`);
        return true;
    } catch (e) {
        console.error('❌ Erreur restauration réactions:', e.message);
        return false;
    }
}

// ==========================================
// PANNEAU /absence — Tracking réactions en temps réel
// ==========================================
// On track les réactions en live au lieu de fetch l'API à chaque refresh
// Map<userId, 'check'|'retard'|'no'>
const reactionsOP1 = new Map();
const reactionsOP2 = new Map();

function getReactionMap(messageId) {
    if (presenceData.messageId === messageId) return reactionsOP1;
    if (presence2Data.messageId === messageId) return reactionsOP2;
    return null;
}

function emojiToType(emojiName, emojiId) {
    if (emojiName === 'check' || emojiId === '1486393925219647519') return 'check';
    if (emojiName === 'retard1' || emojiId === '1486400147654049924') return 'retard';
    if (emojiName === 'no' || emojiId === '1486417914084069507') return 'no';
    return null;
}

// Cache pour les absences du salon (mis à jour toutes les 60s)
let absenceSalonCache = { validAbsences: new Set(), invalidAbsences: new Set(), validAbsenceNames: [], invalidAbsenceNames: [] };
let absenceCacheUpdating = false;

async function updateAbsenceSalonCache() {
    if (absenceCacheUpdating) return;
    absenceCacheUpdating = true;
    try {
        absenceSalonCache = await getAbsentUsersToday();
    } catch {} finally {
        absenceCacheUpdating = false;
    }
}

// Construction du panneau — utilise des embeds Discord (visuel propre)
function buildAbsencePanelEmbeds() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    const role = guild ? guild.roles.cache.get(CONFIG.ROLES.MEMBRE_1) : null;

    const embeds = [];

    // ── Header embed ──
    const header = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle('📋 Suivi Présence OP')
        .setDescription(`📅 **${dateStr}** • ⏰ **${timeStr}**`)
        .setFooter({ text: 'Mise à jour auto toutes les 30s • Tape /absence pour rafraîchir' });
    embeds.push(header);

    // ── 1ère OP ──
    embeds.push(buildPresenceEmbed('1ère Présence OP', presenceData, reactionsOP1, role, absenceSalonCache, 0x57F287));

    // ── 2ème OP ──
    embeds.push(buildPresenceEmbed('2ème Présence OP', presence2Data, reactionsOP2, role, absenceSalonCache, 0x5865F2));

    // ── Absences salon ──
    embeds.push(buildAbsenceSalonEmbed(absenceSalonCache));

    // ── Résumé hebdo ──
    embeds.push(buildWeeklySummaryEmbed());

    return embeds;
}

function buildPresenceEmbed(title, data, reactionMap, role, absData, color) {
    const embed = new EmbedBuilder().setTitle(`📋 ${title}`).setColor(color);

    if (!data.active || !data.messageId) {
        return embed.setDescription('⚠️ *Pas encore lancée*').setColor(0x95A5A6);
    }

    if (data.terminated) {
        return embed.setDescription('⏹️ *Terminée*').setColor(0x95A5A6);
    }

    if (!role) return embed.setDescription('❌ Rôle introuvable');

    const present = [], late = [], absentReact = [], absentValid = [], noReaction = [];

    for (const [, member] of role.members) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(CONFIG.ROLES.EXCLUDED_ROLE)) continue;

        const name = member.nickname || member.user.username;
        const reaction = reactionMap.get(member.id);

        if (reaction === 'check') present.push(name);
        else if (reaction === 'retard') late.push(name);
        else if (reaction === 'no') absentReact.push(name);
        else if (absData.validAbsences.has(member.id)) absentValid.push(name);
        else noReaction.push(name);
    }

    const total = present.length + late.length + absentReact.length + absentValid.length + noReaction.length;

    // Format intelligent : si trop long pour un field, on tronque avec "...et X autres"
    const formatList = (list) => {
        if (list.length === 0) return '*Aucun*';
        let text = list.map(n => `• ${n}`).join('\n');
        if (text.length <= 1024) return text;

        // Trop long : on tronque
        const truncated = [];
        let len = 0;
        for (const n of list) {
            const line = `• ${n}\n`;
            if (len + line.length > 950) {
                truncated.push(`*...et ${list.length - truncated.length} autres*`);
                break;
            }
            truncated.push(line.trim());
            len += line.length;
        }
        return truncated.join('\n');
    };

    embed.setDescription(`👥 **${total}** membres au total`);
    embed.addFields(
        { name: `✅ Présents — ${present.length}`, value: formatList(present), inline: false },
        { name: `⏰ Retards — ${late.length}`, value: formatList(late), inline: false },
        { name: `❌ Absents non justifiés — ${absentReact.length}`, value: formatList(absentReact), inline: false },
        { name: `📋 Absents justifiés — ${absentValid.length}`, value: formatList(absentValid), inline: false },
        { name: `⚠️ Pas de réaction — ${noReaction.length}`, value: formatList(noReaction), inline: false },
    );

    return embed;
}

function buildAbsenceSalonEmbed(data) {
    const embed = new EmbedBuilder().setTitle('📅 Absences posées dans le salon').setColor(0xFEE75C);

    const validNames = data.validAbsenceNames || [];
    const invalidNames = data.invalidAbsenceNames || [];

    if (validNames.length === 0 && invalidNames.length === 0) {
        return embed.setDescription('*Aucune absence posée*');
    }

    const formatList = (list) => list.length === 0 ? '*Aucune*' : list.map(n => `• ${n}`).join('\n');
    embed.addFields(
        { name: `✅ Conformes — ${validNames.length}`, value: formatList(validNames).slice(0, 1024), inline: false },
        { name: `❌ Non conformes — ${invalidNames.length}`, value: formatList(invalidNames).slice(0, 1024), inline: false },
    );

    return embed;
}

function buildWeeklySummaryEmbed() {
    const embed = new EmbedBuilder().setTitle('📊 Suivi hebdomadaire — Absences').setColor(0xED4245);

    if (absenceTracking.size === 0) {
        return embed.setDescription('✨ *Aucune absence enregistrée cette semaine*').setColor(0x57F287);
    }

    const sorted = [...absenceTracking.entries()].sort((a, b) => b[1].count - a[1].count);
    const consecutive = [], classic = [];

    for (const entry of sorted) {
        const [, data] = entry;
        const consec = getConsecutiveDays(data);
        if (consec >= 2) consecutive.push({ entry, consec });
        else classic.push(entry);
    }

    // Section consécutifs
    if (consecutive.length > 0) {
        const lines = [];
        for (const { entry: [, data], consec } of consecutive) {
            lines.push(`**⚠️ ${data.username}** — *${consec} jours consécutifs* (${data.count} total)`);
            if (data.details) {
                for (const d of data.details) {
                    lines.push(`  ${d.justified ? '✅' : '❌'} ${d.date} • ${d.op}`);
                }
            }
        }
        embed.addFields({ name: '🚨 Absences consécutives (alerte KP)', value: lines.join('\n').slice(0, 1024), inline: false });
    }

    // Section classique
    if (classic.length > 0) {
        const lines = [];
        for (const [, data] of classic) {
            lines.push(`**${data.username}** — ${data.count} absence(s)`);
            if (data.details) {
                for (const d of data.details) {
                    lines.push(`  ${d.justified ? '✅' : '❌'} ${d.date} • ${d.op}`);
                }
            }
        }
        embed.addFields({ name: '📋 Absences cette semaine', value: lines.join('\n').slice(0, 1024), inline: false });
    }

    embed.setFooter({ text: '🚨 = 2+ jours consécutifs → KP • Reset : Dimanche 22h00' });
    return embed;
}

// ==========================================
// Détection jours consécutifs (utilisé par embeds)
// ==========================================
function getConsecutiveDays(data) {
    if (!data.details || data.details.length === 0) return 0;

    const unjustifiedDates = [...new Set(
        data.details
            .filter(d => !d.justified)
            .map(d => d.date)
    )];

    if (unjustifiedDates.length === 0) return 0;

    const year = new Date().getFullYear();
    const parsed = unjustifiedDates.map(d => {
        const [day, month] = d.split('/').map(Number);
        return new Date(year, month - 1, day);
    }).sort((a, b) => b - a);

    let consecutive = 1;
    for (let i = 0; i < parsed.length - 1; i++) {
        const diff = (parsed[i] - parsed[i + 1]) / (1000 * 60 * 60 * 24);
        if (diff === 1) consecutive++;
        else break;
    }

    return consecutive;
}

// ==========================================
// PANNEAU — Rafraîchissement
// ==========================================
async function refreshAbsencePanel() {
    if (!absencePanelData.channelId || !absencePanelData.messageIds || absencePanelData.messageIds.length === 0) return;

    try {
        // Timeout de sécurité — 10s max pour le cache absences
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000));
        await Promise.race([updateAbsenceSalonCache(), timeout]).catch(() => {});

        const channel = client.channels.cache.get(absencePanelData.channelId);
        if (!channel) return;

        const embeds = buildAbsencePanelEmbeds();

        // Mettre à jour chaque message avec son embed correspondant
        for (let i = 0; i < absencePanelData.messageIds.length; i++) {
            try {
                const msg = await channel.messages.fetch(absencePanelData.messageIds[i]).catch(() => null);
                if (!msg) continue;
                if (i < embeds.length) {
                    await msg.edit({ embeds: [embeds[i]] }).catch(() => {});
                }
            } catch {}
        }
    } catch (e) {
        console.error('⚠️ Refresh panneau erreur (non bloquant):', e.message);
    }
}

function startAbsencePanelRefresh() {
    stopAbsencePanelRefresh();
    absencePanelData.refreshInterval = setInterval(() => refreshAbsencePanel(), 30_000);
}

function stopAbsencePanelRefresh() {
    if (absencePanelData.refreshInterval) {
        clearInterval(absencePanelData.refreshInterval);
        absencePanelData.refreshInterval = null;
    }
}

// ==========================================
// ENREGISTREMENT COMMANDES
// ==========================================
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder().setName('qg').setDescription('🚨 Appel au QG'),
        new SlashCommandBuilder().setName('garage').setDescription('🚨 Appel au Garage Hood'),
        new SlashCommandBuilder().setName('alignement').setDescription('🚨 Demande d\'alignement'),
        new SlashCommandBuilder().setName('tir').setDescription('🚨 Arrêter de tirer'),
        new SlashCommandBuilder().setName('position').setDescription('🚨 Prendre des positions'),
        new SlashCommandBuilder().setName('defense').setDescription('🚨 Défense du laboratoire'),
        new SlashCommandBuilder().setName('weed').setDescription('🚨 Alerte weed'),
        new SlashCommandBuilder().setName('traitement-weed').setDescription('🚨 Traitement de la weed'),
        new SlashCommandBuilder().setName('trash').setDescription('🚨 Avertissement trash'),
        new SlashCommandBuilder().setName('radio').setDescription('📻 Nouvelle fréquence radio'),
        new SlashCommandBuilder().setName('presence-test').setDescription('🧪 Test 1ère présence OP'),
        new SlashCommandBuilder().setName('presence-test2').setDescription('🧪 Test 2ème présence OP'),
        new SlashCommandBuilder().setName('presence2').setDescription('📋 Envoie la 2ème présence OP (sans relances)'),
        new SlashCommandBuilder().setName('absence').setDescription('📋 Panneau suivi présences/absences'),
        new SlashCommandBuilder()
            .setName('presence-edit')
            .setDescription('✏️ Modifier la liste du message de présence')
            .addStringOption(o => o.setName('liste').setDescription('Sépare par / — Ex: Armes / Eau / Pochons').setRequired(false)),
        new SlashCommandBuilder()
            .setName('clear')
            .setDescription('🧹 Supprime les messages du bot')
            .addIntegerOption(o => o.setName('nombre').setDescription('Nombre (défaut 100)').setRequired(false)),
        new SlashCommandBuilder()
            .setName('clearmessage')
            .setDescription('🧹 Supprime X messages')
            .addIntegerOption(o => o.setName('nombre').setDescription('Nombre').setRequired(true)),
        new SlashCommandBuilder()
            .setName('annonce')
            .setDescription('📢 Annonce avec mention')
            .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true))
            .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),
        new SlashCommandBuilder().setName('presence-force').setDescription('🔄 Force le démarrage de la présence OP (si redéployé en cours)'),
        new SlashCommandBuilder().setName('panel').setDescription('🎮 Ouvrir le panneau de contrôle (rappels programmés)'),
    ];

    const rest = new REST().setToken(CONFIG.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), { body: commands.map(c => c.toJSON()) });
        console.log('✅ Commandes enregistrées');
    } catch (error) {
        console.error('❌ Erreur commandes:', error);
    }
}

// ==========================================
// BOT PRÊT
// ==========================================
client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} connecté | ${client.guilds.cache.size} serveur(s)`);
    await registerCommands();
    setupPresenceCron();

    // Charger les rappels du panel
    loadReminders();
    if (reminders.some(r => r.enabled)) {
        startReminderLoop();
        console.log('⏰ Boucle de rappels démarrée');
    }

    // Restaurer les flows de welcome en cours (après redéploiement)
    try {
        const savedWelcomes = loadWelcomeStateData();
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const now = Date.now();
        let restored = 0;

        for (const [userId, state] of Object.entries(savedWelcomes)) {
            // Si le welcome a plus de 10 minutes, on le considère expiré
            const age = now - (state.createdAt || 0);
            if (age > 10 * 60 * 1000) continue;

            // Restaurer en mémoire
            welcomeState.set(userId, state);
            restored++;

            // Relancer un kick timer pour le délai restant
            const remainingTime = WELCOME_KICK_DELAY - age;
            if (remainingTime > 0 && guild) {
                setTimeout(async () => {
                    const current = welcomeState.get(userId);
                    if (!current || current.messageId !== state.messageId) return; // Déjà avancé

                    try {
                        const channel = guild.channels.cache.get(CONFIG.CHANNELS.REGLEMENT);
                        const msg = channel ? await channel.messages.fetch(state.messageId).catch(() => null) : null;
                        if (msg) await msg.delete().catch(() => {});

                        const member = await guild.members.fetch(userId).catch(() => null);
                        if (member) {
                            const hasProtected = CONFIG.ROLES.PROTECTED_ROLES.some(r => member.roles.cache.has(r));
                            if (!hasProtected) await member.kick('Timeout (restauré)').catch(() => {});
                        }
                    } catch {}
                    deleteWelcomeState(userId);
                }, remainingTime);
            }
        }

        // Nettoyer les expirés du fichier
        if (restored !== Object.keys(savedWelcomes).length) saveWelcomeState();

        if (restored > 0) console.log(`👋 ${restored} flow(s) de welcome restauré(s)`);
    } catch (e) {
        console.error('⚠️ Erreur restauration welcome:', e.message);
    }

    // Prefetch membres + absences au boot
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        if (guild) {
            await guild.members.fetch();
            console.log(`👥 ${guild.members.cache.size} membres mis en cache`);

            // Vérifier les auto-rôles
            for (const [userId, roleId] of Object.entries(CONFIG.AUTO_ROLE_USERS)) {
                try {
                    const member = guild.members.cache.get(userId);
                    if (member && !member.roles.cache.has(roleId)) {
                        const role = guild.roles.cache.get(roleId);
                        if (role) {
                            await member.roles.add(role);
                            console.log(`🎯 Auto-rôle restauré pour ${member.user.tag}`);
                        }
                    }
                } catch {}
            }
        }
        await updateAbsenceSalonCache();
        console.log('📋 Cache absences salon initialisé');
    } catch (e) {
        console.error('⚠️ Erreur prefetch:', e.message);
    }

    // Restaurer l'état de présence si le bot a été redéployé en cours d'OP
    const savedState = loadPresenceState();
    let op1Restored = false;
    let op2Restored = false;

    if (savedState) {
        if (savedState.op1 && savedState.op1.active && savedState.op1.messageId) {
            console.log('🔄 Restauration 1ère Présence OP depuis fichier...');
            const restored = await restoreReactionsFromMessage(savedState.op1.messageId, reactionsOP1);
            if (restored) {
                presenceData.messageId = savedState.op1.messageId;
                presenceData.active = true;
                op1Restored = true;
                console.log('✅ 1ère Présence OP restaurée');

                // Relancer les rappels et crons
                const channel = client.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
                if (channel) {
                    const msg = await channel.messages.fetch(savedState.op1.messageId).catch(() => null);
                    if (msg) startPresenceReminders(channel, msg);
                }
            } else {
                console.log('⚠️ Message 1ère OP introuvable dans le fichier');
            }
        }

        if (savedState.op2 && savedState.op2.active && savedState.op2.messageId) {
            console.log('🔄 Restauration 2ème Présence OP depuis fichier...');
            const restored = await restoreReactionsFromMessage(savedState.op2.messageId, reactionsOP2);
            if (restored) {
                presence2Data.messageId = savedState.op2.messageId;
                presence2Data.active = true;
                op2Restored = true;
                console.log('✅ 2ème Présence OP restaurée');
            } else {
                console.log('⚠️ Message 2ème OP introuvable');
            }
        }
    }

    // FALLBACK : scanner le salon présence si rien n'a été restauré
    // (couvre le cas où le fichier state est manquant/corrompu mais qu'une présence est en cours)
    if (!op1Restored || !op2Restored) {
        try {
            const presenceChannel = client.guilds.cache.get(CONFIG.GUILD_ID)?.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
            if (presenceChannel) {
                console.log('🔍 Scan du salon présence pour récupérer une OP en cours...');
                const messages = await presenceChannel.messages.fetch({ limit: 30 }).catch(() => null);
                if (messages) {
                    // Chercher les messages bot non périmés (< 24h)
                    const now = Date.now();
                    const ONE_DAY = 24 * 60 * 60 * 1000;

                    for (const [, msg] of messages) {
                        if (msg.author.id !== client.user.id) continue;
                        if (now - msg.createdTimestamp > ONE_DAY) continue;

                        const content = msg.content || '';

                        // Détection 1ère présence OP (contient "Présence OP" + role mention)
                        if (!op1Restored && /Présence OP/i.test(content) && content.includes(`<@&${CONFIG.ROLES.MEMBRE_1}>`) && /20H45|21H00/i.test(content)) {
                            console.log(`🔄 OP1 détectée dans le salon (msg ${msg.id})`);
                            const restored = await restoreReactionsFromMessage(msg.id, reactionsOP1);
                            if (restored) {
                                presenceData.messageId = msg.id;
                                presenceData.active = true;
                                op1Restored = true;
                                savePresenceState();
                                startPresenceReminders(presenceChannel, msg);
                                console.log('✅ 1ère Présence OP récupérée depuis le salon');
                            }
                        }

                        // Détection 2ème présence OP (contient "Merci de réagir si vous êtes présent")
                        if (!op2Restored && /Merci de réagir si vous êtes présent/i.test(content)) {
                            console.log(`🔄 OP2 détectée dans le salon (msg ${msg.id})`);
                            const restored = await restoreReactionsFromMessage(msg.id, reactionsOP2);
                            if (restored) {
                                presence2Data.messageId = msg.id;
                                presence2Data.active = true;
                                op2Restored = true;
                                savePresenceState();
                                console.log('✅ 2ème Présence OP récupérée depuis le salon');
                            }
                        }
                    }

                    if (!op1Restored && !op2Restored) {
                        console.log('ℹ️ Aucune OP active détectée dans le salon');
                    }
                }
            }
        } catch (e) {
            console.error('❌ Erreur scan salon présence:', e.message);
        }
    }

    cron.schedule('0 22 * * 0', () => {
        console.log('📊 RESET HEBDO ABSENCES');
        absenceTracking.clear();
        saveAbsenceTracking();
    }, { timezone: 'Europe/Paris' });

    if (TURBO_MODE) setTimeout(() => sendPresenceMessage(), 3_000);
});

// ==========================================
// NOUVEAU MEMBRE
// ==========================================
client.on('guildMemberAdd', async (member) => {
    // Auto-attribution de rôles spécifiques
    const autoRoleId = CONFIG.AUTO_ROLE_USERS[member.id];
    if (autoRoleId) {
        try {
            const role = member.guild.roles.cache.get(autoRoleId);
            if (role) {
                await member.roles.add(role);
                console.log(`🎯 Auto-rôle attribué à ${member.user.tag} : ${role.name}`);
            }
        } catch (e) {
            console.error(`❌ Erreur auto-rôle ${member.user.tag}:`, e.message);
        }
    }

    // VIP → rôle direct, pas d'accueil
    if (CONFIG.VIP_USERS.includes(member.id)) {
        try {
            const role = member.guild.roles.cache.get(CONFIG.ROLES.VIP_ROLE);
            if (role) await member.roles.add(role);
        } catch {}
        return;
    }

    // Rôle protégé → pas d'accueil
    const hasProtectedRole = CONFIG.ROLES.PROTECTED_ROLES.some(r => member.roles.cache.has(r));
    if (hasProtectedRole) {
        console.log(`🛡️ ${member.user.tag} a un rôle protégé, pas de flow d'accueil`);
        return;
    }

    await startWelcomeFlow(member);
});

// ==========================================
// RÔLE SUPPRIMÉ → Relance accueil
// ==========================================
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // Auto-rôle : si retiré, le redonner
    const autoRoleId = CONFIG.AUTO_ROLE_USERS[newMember.id];
    if (autoRoleId && oldMember.roles.cache.has(autoRoleId) && !newMember.roles.cache.has(autoRoleId)) {
        try {
            const role = newMember.guild.roles.cache.get(autoRoleId);
            if (role) {
                await newMember.roles.add(role);
                console.log(`🎯 Auto-rôle ré-attribué à ${newMember.user.tag} (avait été retiré)`);
            }
        } catch (e) {
            console.error(`❌ Erreur ré-attribution auto-rôle:`, e.message);
        }
        return; // On stoppe ici pour éviter les autres traitements
    }

    const rs = renameCheckState.get(newMember.id);
    if (rs) {
        const oldN = oldMember.nickname || oldMember.user.username;
        const newN = newMember.nickname || newMember.user.username;
        if (oldN !== newN && newN !== rs.originalName) renameCheckState.delete(newMember.id);
    }

    if (roleRemovalProcessing.has(newMember.id) || welcomeState.has(newMember.id)) return;

    const lost3 = oldMember.roles.cache.has(CONFIG.ROLES.MEMBRE_3) && !newMember.roles.cache.has(CONFIG.ROLES.MEMBRE_3);

    if (lost3) {
        // Ne pas relancer si le membre a un rôle protégé
        const hasProtectedRole = CONFIG.ROLES.PROTECTED_ROLES.some(r => newMember.roles.cache.has(r));
        if (hasProtectedRole) {
            console.log(`🛡️ ${newMember.user.tag} a un rôle protégé, pas de relance accueil`);
            return;
        }

        // Vérifier si l'utilisateur a déjà un rôle de promotion AU MOMENT du retrait
        const hasPromotionAlready = CONFIG.ROLES.PROMOTION_ROLES.some(r => newMember.roles.cache.has(r));
        if (hasPromotionAlready) {
            console.log(`⬆️ ${newMember.user.tag} : MEMBRE_3 retiré mais a déjà un rôle de promotion → pas de relance accueil`);
            return;
        }

        // Pas encore promu → on attend 5 minutes pour voir si une promotion arrive
        const userId = newMember.id;
        if (pendingPromotionChecks.has(userId)) {
            // Déjà une vérification en cours, on l'annule pour la remplacer
            clearTimeout(pendingPromotionChecks.get(userId));
        }

        console.log(`⏳ ${newMember.user.tag} : MEMBRE_3 retiré → attente 5min pour promotion`);

        const timer = setTimeout(async () => {
            pendingPromotionChecks.delete(userId);
            try {
                const guild = client.guilds.cache.get(newMember.guild.id);
                if (!guild) return;

                const m = await guild.members.fetch(userId).catch(() => null);
                if (!m) return; // Quitté le serveur

                // Re-vérifier les conditions APRÈS les 5 minutes
                const stillLost3 = !m.roles.cache.has(CONFIG.ROLES.MEMBRE_3);
                const nowHasPromotion = CONFIG.ROLES.PROMOTION_ROLES.some(r => m.roles.cache.has(r));
                const nowProtected = CONFIG.ROLES.PROTECTED_ROLES.some(r => m.roles.cache.has(r));

                if (!stillLost3) {
                    console.log(`↩️ ${m.user.tag} : MEMBRE_3 récupéré entre temps → rien à faire`);
                    return;
                }
                if (nowHasPromotion) {
                    console.log(`⬆️ ${m.user.tag} : promu pendant les 5min → rien à faire`);
                    return;
                }
                if (nowProtected) {
                    console.log(`🛡️ ${m.user.tag} : protégé → rien à faire`);
                    return;
                }

                // Pas de promotion → relance le flow d'accueil
                console.log(`🔄 ${m.user.tag} : pas de promotion après 5min → relance accueil`);

                roleRemovalProcessing.add(userId);
                setTimeout(() => roleRemovalProcessing.delete(userId), 10_000);

                // Retirer les autres rôles d'accueil restants
                if (m.roles.cache.has(CONFIG.ROLES.MEMBRE_1)) await m.roles.remove(CONFIG.ROLES.MEMBRE_1).catch(() => {});
                if (m.roles.cache.has(CONFIG.ROLES.MEMBRE_2)) await m.roles.remove(CONFIG.ROLES.MEMBRE_2).catch(() => {});

                await startWelcomeFlow(m);
            } catch (e) {
                console.error('❌ Erreur vérif promotion:', e.message);
            }
        }, 5 * 60 * 1000); // 5 minutes

        pendingPromotionChecks.set(userId, timer);
    }
});

// ==========================================
// FLOW D'ACCUEIL
// ==========================================
async function startWelcomeFlow(member) {
    const channel = member.guild.channels.cache.get(CONFIG.CHANNELS.REGLEMENT);
    if (!channel) return;

    const oldState = welcomeState.get(member.id);
    if (oldState && oldState.kickTimer) clearTimeout(oldState.kickTimer);

    try {
        await runWelcomeStep(channel, member.guild, member, 1);
        setTimeout(async () => {
            const state = welcomeState.get(member.id);
            if (state && state.step === 1) {
                try {
                    const p1 = await channel.send(`${member}`);
                    await sleep(500);
                    const p2 = await channel.send(`${member}`);
                    await sleep(2_000);
                    await p1.delete().catch(() => {});
                    await p2.delete().catch(() => {});
                } catch {}
            }
        }, 60_000);
    } catch {}
}

async function runWelcomeStep(channel, guild, member, step) {
    const userId = member.id || member.user?.id;

    const messages = {
        1: `Salut à toi ${member} ! 👋\n\nLis bien le règlement et quand cela est fait, clique sur la réaction ${CONFIG.EMOJIS.CHECK}`,
        2: `${member} Tu as bien lu le règlement ? ${CONFIG.EMOJIS.CHECK}`,
        3: `${member} Tu es vraiment sûr ? Tu vas pas être kp au bout d'une heure car tu as pas tout lu ? Si tu as tout lu réagi avec ${CONFIG.EMOJIS.CHECK}`,
        4: `${member} Donc tu as compris que ça va être une tyrannie, tu es toujours sûr de vouloir rejoindre ?`,
    };

    const reactions = {
        1: [CONFIG.REACT_EMOJIS.CHECK, CONFIG.REACT_EMOJIS.NO],
        2: [CONFIG.REACT_EMOJIS.CHECK, CONFIG.REACT_EMOJIS.NO],
        3: [CONFIG.REACT_EMOJIS.CHECK, CONFIG.REACT_EMOJIS.NO],
        4: [CONFIG.REACT_EMOJIS.CHECK, CONFIG.REACT_EMOJIS.BM, CONFIG.REACT_EMOJIS.NO],
    };

    const msg = await channel.send(messages[step]);
    for (const emoji of reactions[step]) await safeReact(msg, emoji);
    welcomeState.set(userId, { step, messageId: msg.id, guildId: guild.id, createdAt: Date.now() });
    saveWelcomeState();

    const filter = (reaction, user) => {
        if (user.bot || user.id !== userId) return false;
        const n = reaction.emoji.name, id = reaction.emoji.id;
        return n === 'check' || id === '1486393925219647519' || n === 'no' || id === '1486417914084069507' || n === 'bm' || id === '1489337087282118686' || n === '✅' || n === '❌';
    };

    const collector = msg.createReactionCollector({ filter, max: 1, time: WELCOME_KICK_DELAY });

    collector.on('collect', async (reaction) => {
        const isNo = reaction.emoji.name === 'no' || reaction.emoji.id === '1486417914084069507' || reaction.emoji.name === '❌';
        await msg.delete().catch(() => {});

        if (isNo) {
            try { const m = await guild.members.fetch(userId); await m.kick('Refusé'); } catch {}
            deleteWelcomeState(userId);
            return;
        }

        if (step < 4) return runWelcomeStep(channel, guild, member, step + 1);

        const welcomeMsg = await channel.send(`${member} Très bien, bienvenu à toi jeune **21 Block Savage** ! ${CONFIG.EMOJIS.BS21}`);

        try {
            const fm = await guild.members.fetch(userId);
            for (const rId of [CONFIG.ROLES.MEMBRE_1, CONFIG.ROLES.MEMBRE_2, CONFIG.ROLES.MEMBRE_3]) {
                const r = guild.roles.cache.get(rId);
                if (r) await fm.roles.add(r);
            }

            const origName = fm.nickname || fm.user.username;
            renameCheckState.set(userId, { originalName: origName, guildId: guild.id });

            setTimeout(async () => {
                const rs = renameCheckState.get(userId);
                if (!rs) return;
                try {
                    const g = client.guilds.cache.get(rs.guildId);
                    const m = await g.members.fetch(userId).catch(() => null);
                    if (!m) { renameCheckState.delete(userId); return; }
                    if (m.roles.cache.has(CONFIG.ROLES.EXCLUDED_RENAME)) { renameCheckState.delete(userId); return; }
                    const hasProtected = CONFIG.ROLES.PROTECTED_ROLES.some(r => m.roles.cache.has(r));
                    if (hasProtected) { renameCheckState.delete(userId); return; }
                    if ((m.nickname || m.user.username) === rs.originalName) {
                        await m.send(`Salut, tu viens d'être Kick du Serveur **21 Block Savage** ${CONFIG.EMOJIS.BS21} car tu ne t'es pas renommé.\nA bientôt ! ${CONFIG.EMOJIS.BS21}`).catch(() => {});
                        await m.kick('Pas renommé').catch(() => {});
                    }
                    renameCheckState.delete(userId);
                } catch { renameCheckState.delete(userId); }
            }, RENAME_KICK_DELAY);
        } catch {}

        deleteWelcomeState(userId);
        setTimeout(() => welcomeMsg.delete().catch(() => {}), 30_000);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            msg.delete().catch(() => {});
            guild.members.fetch(userId).then(m => {
                const hasProtected = CONFIG.ROLES.PROTECTED_ROLES.some(r => m.roles.cache.has(r));
                if (!hasProtected) m.kick('Timeout').catch(() => {});
            }).catch(() => {});
            deleteWelcomeState(userId);
        }
    });
}

// ==========================================
// MESSAGES (BM + !presence)
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id && message.channelId === CONFIG.CHANNELS.BM_NOTIF) return;

    if (message.channelId === CONFIG.CHANNELS.BM_ANNONCES) {
        const ch = client.channels.cache.get(CONFIG.CHANNELS.BM_NOTIF);
        if (!ch) return;
        try {
            await ch.send({
                content: `Une annonce du Black Market ${CONFIG.EMOJIS.BM} vient d'être postée <#${CONFIG.CHANNELS.BM_ANNONCES}>. Merci de réagir au message et d'appliquer les actions demandées si nécessaire.\nPour rappel, aucune réaction troll n'est tolérée. Seuls les hauts gradés sont autorisés à répondre ${CONFIG.EMOJIS.ATTENTION}\n\n||<@&${CONFIG.ROLES.MEMBRE_1}>||`,
                allowedMentions: { parse: ['roles'] }
            });
        } catch {}
        return;
    }

    if (message.channelId === CONFIG.CHANNELS.COMMANDES && message.content.startsWith('!presence')) {
        if (message.author.bot) return;
        if (!CONFIG.ROLES.COMMAND_ROLES.some(r => message.member.roles.cache.has(r))) return;

        const content = message.content.replace(/^!presence\s*/, '').trim();
        if (!content) {
            const reply = await message.reply(`📋 **Message actuel :**\n\n${customPresenceMessage || '*(Défaut)*'}\n\n\`!presence reset\` pour réinitialiser.`);
            await message.delete().catch(() => {});
            setTimeout(() => reply.delete().catch(() => {}), 30_000);
            return;
        }
        if (content.toLowerCase() === 'reset') {
            customPresenceMessage = null;
            const reply = await message.reply('✅ Réinitialisé.');
            await message.delete().catch(() => {});
            setTimeout(() => reply.delete().catch(() => {}), 10_000);
            return;
        }
        customPresenceMessage = content;
        const reply = await message.reply('✅ Message mis à jour !');
        await message.delete().catch(() => {});
        setTimeout(() => reply.delete().catch(() => {}), 30_000);
    }
});

// ==========================================
// RÉACTIONS → Refresh panneau
// ==========================================
// Debounce pour le refresh du panneau
let panelRefreshTimeout = null;
function scheduleAbsencePanelRefresh() {
    if (!absencePanelData.messageId) return;
    if (panelRefreshTimeout) clearTimeout(panelRefreshTimeout);
    panelRefreshTimeout = setTimeout(() => {
        refreshAbsencePanel();
        panelRefreshTimeout = null;
    }, 2_000);
}

client.on('messageDelete', async (message) => {
    // Si le message de la 2ème OP est supprimé manuellement → stop la présence
    if (presence2Data.messageId === message.id) {
        console.log('🗑️ Message 2ème OP supprimé manuellement → arrêt présence');
        presence2Data = { messageId: null, active: false };
        reactionsOP2.clear();
        savePresenceState();
        await refreshAbsencePanel();
    }

    // Idem pour la 1ère OP
    if (presenceData.messageId === message.id) {
        console.log('🗑️ Message 1ère OP supprimé manuellement → arrêt présence');
        if (presenceData.reminderInterval) clearInterval(presenceData.reminderInterval);
        presenceData = { messageId: null, reminderIds: [], reminderInterval: null, active: false };
        reactionsOP1.clear();
        savePresenceState();
        await refreshAbsencePanel();
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // ─── Fallback Welcome ─────────────────────────────
    // Ce handler ne sert QU'À rattraper les messages d'avant un redéploiement.
    // En conditions normales, le createReactionCollector du flow d'accueil traite tout.
    // Pour éviter les doublons, on n'agit que sur les messages créés AVANT le démarrage du bot.
    try {
        const msg = reaction.message;
        const msgCreatedAt = msg.createdTimestamp || 0;

        // Si le message a été créé APRÈS le démarrage du bot, le collector original est forcément actif
        // → on ne touche pas, le collector va s'en occuper
        if (msgCreatedAt >= botStartTime - 1000) {
            // Continuer vers le traitement normal des réactions présence OP
        } else {
            // Message d'avant le démarrage → le collector est mort, on tente le rattrapage

            // 1. Cherche dans le state restauré
            let foundState = null;
            for (const [userId, state] of welcomeState) {
                if (state.messageId === msg.id && userId === user.id) {
                    foundState = state;
                    break;
                }
            }

            if (foundState) {
                await handleWelcomeReactionFallback(reaction, user, foundState);
                return;
            }

            // 2. Pas de state : auto-détection par le contenu du message
            if (msg.channelId === CONFIG.CHANNELS.REGLEMENT) {
                let fullMsg = msg;
                if (msg.partial) {
                    try { fullMsg = await msg.fetch(); } catch { return; }
                }

                if (fullMsg.author.id !== client.user.id) return;

                const content = fullMsg.content || '';
                let detectedStep = null;
                if (/Lis bien le règlement/i.test(content)) detectedStep = 1;
                else if (/Tu as bien lu le règlement/i.test(content)) detectedStep = 2;
                else if (/Tu es vraiment sûr/i.test(content)) detectedStep = 3;
                else if (/tu as compris que ça va être une tyrannie/i.test(content)) detectedStep = 4;

                if (!detectedStep) return;

                if (!content.includes(`<@${user.id}>`) && !content.includes(`<@!${user.id}>`)) return;

                console.log(`🔄 Welcome auto-détecté (msg pré-démarrage) : step ${detectedStep} pour ${user.tag || user.username}`);

                const reconstructedState = {
                    step: detectedStep,
                    messageId: fullMsg.id,
                    guildId: fullMsg.guildId || CONFIG.GUILD_ID,
                    createdAt: fullMsg.createdTimestamp,
                };
                welcomeState.set(user.id, reconstructedState);
                saveWelcomeState();

                await handleWelcomeReactionFallback(reaction, user, reconstructedState);
                return;
            }
        }
    } catch (e) {
        console.error('❌ Fallback welcome:', e.message);
    }

    // ─── Réactions présence OP ────────────────────────
    const msgId = reaction.message.id;
    const map = getReactionMap(msgId);
    if (!map) return;

    const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
    if (type) {
        map.set(user.id, type);
        scheduleAbsencePanelRefresh();
    }
});

// Handler de fallback pour les réactions de welcome (quand le collector est mort)
async function handleWelcomeReactionFallback(reaction, user, state) {
    const userId = user.id;
    const isCheck = reaction.emoji.name === 'check' || reaction.emoji.id === '1486393925219647519' || reaction.emoji.name === '✅';
    const isNo = reaction.emoji.name === 'no' || reaction.emoji.id === '1486417914084069507' || reaction.emoji.name === '❌';
    const isBM = reaction.emoji.name === 'bm' || reaction.emoji.id === '1489337087282118686';

    if (!isCheck && !isNo && !isBM) return; // Réaction non reconnue

    const guild = client.guilds.cache.get(state.guildId || CONFIG.GUILD_ID);
    if (!guild) return;
    const channel = guild.channels.cache.get(CONFIG.CHANNELS.REGLEMENT);
    if (!channel) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    // Supprimer le message actuel
    try {
        const oldMsg = await channel.messages.fetch(state.messageId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
    } catch {}

    // Refus → kick
    if (isNo) {
        try { await member.kick('Refusé'); } catch {}
        deleteWelcomeState(userId);
        return;
    }

    // Validé : passer à l'étape suivante OU finaliser
    if (state.step < 4) {
        await runWelcomeStep(channel, guild, member, state.step + 1);
        return;
    }

    // Étape 4 validée → donner les rôles
    const welcomeMsg = await channel.send(`${member} Très bien, bienvenu à toi jeune **21 Block Savage** ! ${CONFIG.EMOJIS.BS21}`);

    try {
        for (const rId of [CONFIG.ROLES.MEMBRE_1, CONFIG.ROLES.MEMBRE_2, CONFIG.ROLES.MEMBRE_3]) {
            const r = guild.roles.cache.get(rId);
            if (r) await member.roles.add(r);
        }

        const origName = member.nickname || member.user.username;
        renameCheckState.set(userId, { originalName: origName, guildId: guild.id });

        setTimeout(async () => {
            const rs = renameCheckState.get(userId);
            if (!rs) return;
            try {
                const g = client.guilds.cache.get(rs.guildId);
                const m = await g.members.fetch(userId).catch(() => null);
                if (!m) { renameCheckState.delete(userId); return; }
                if (m.roles.cache.has(CONFIG.ROLES.EXCLUDED_RENAME)) { renameCheckState.delete(userId); return; }
                const hasProtected = CONFIG.ROLES.PROTECTED_ROLES.some(r => m.roles.cache.has(r));
                if (hasProtected) { renameCheckState.delete(userId); return; }
                if ((m.nickname || m.user.username) === rs.originalName) {
                    await m.send(`Salut, tu viens d'être Kick du Serveur **21 Block Savage** ${CONFIG.EMOJIS.BS21} car tu ne t'es pas renommé.\nA bientôt ! ${CONFIG.EMOJIS.BS21}`).catch(() => {});
                    await m.kick('Pas renommé').catch(() => {});
                }
                renameCheckState.delete(userId);
            } catch { renameCheckState.delete(userId); }
        }, RENAME_KICK_DELAY);
    } catch {}

    deleteWelcomeState(userId);
    setTimeout(() => welcomeMsg.delete().catch(() => {}), 30_000);
}

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    const msgId = reaction.message.id;
    const map = getReactionMap(msgId);
    if (!map) return;

    const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
    if (type && map.get(user.id) === type) {
        map.delete(user.id);
        scheduleAbsencePanelRefresh();
    }
});

// ==========================================
// COMMANDES SLASH
// ==========================================
client.on('interactionCreate', async (interaction) => {
    // Boutons/modals/selects du /panel (vérification de rôle déjà faite à l'ouverture du panel)
    if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
        if (!CONFIG.ROLES.COMMAND_ROLES.some(r => interaction.member?.roles.cache.has(r))) {
            return interaction.reply({ content: '❌ Pas la permission.', ephemeral: true });
        }
        const handled = await handlePanelInteraction(interaction);
        if (handled) return;
        return; // Pas un handler connu, on ignore
    }

    if (!interaction.isChatInputCommand()) return;

    if (!CONFIG.ROLES.COMMAND_ROLES.some(r => interaction.member.roles.cache.has(r))) {
        return interaction.reply({ content: '❌ Pas la permission.', ephemeral: true });
    }

    const exempt = ['presence-test', 'presence-test2', 'clear', 'clearmessage', 'absence', 'presence-force', 'panel'];
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
    }
});

// ==========================================
// /absence
// ==========================================
async function handleAbsencePanel(interaction) {
    // Supprimer l'ancien panneau en background
    try {
        if (absencePanelData.messageIds && absencePanelData.channelId) {
            const ch = client.channels.cache.get(absencePanelData.channelId);
            if (ch) {
                for (const id of absencePanelData.messageIds) {
                    ch.messages.fetch(id).then(m => m.delete()).catch(() => {});
                }
            }
        }
    } catch {}

    // Construire les embeds (5 max)
    const embeds = buildAbsencePanelEmbeds();

    // Envoyer le premier embed comme reply (instantané)
    try {
        await interaction.reply({ embeds: [embeds[0]] });
    } catch (e) {
        console.error('❌ /absence reply erreur:', e.message);
        return;
    }

    // Envoyer les autres embeds dans des messages séparés en background
    (async () => {
        try {
            const channel = interaction.channel;
            const messageIds = [];

            const reply = await interaction.fetchReply().catch(() => null);
            if (reply) messageIds.push(reply.id);

            // 1 embed par message (évite la limite 6000 chars)
            for (let i = 1; i < embeds.length; i++) {
                try {
                    const msg = await channel.send({ embeds: [embeds[i]] });
                    messageIds.push(msg.id);
                    await sleep(200);
                } catch (e) {
                    console.error(`⚠️ Erreur envoi embed ${i}:`, e.message);
                }
            }

            absencePanelData.messageIds = messageIds;
            absencePanelData.channelId = channel.id;
            absencePanelData.messageId = messageIds[0] || null;
            startAbsencePanelRefresh();
        } catch (e) {
            console.error('❌ Erreur background /absence:', e.message);
        }

        updateAbsenceSalonCache().catch(() => {});
    })();
}

// ==========================================
// /presence-force — Forcer le démarrage de la présence OP
// ==========================================
async function handlePresenceForce(interaction) {
    // Si une présence est déjà active, ne pas en relancer une
    if (presenceData.active) {
        return interaction.reply({ content: '⚠️ Une présence OP est déjà active. Utilise `/presence-test` pour relancer.', ephemeral: true });
    }

    await interaction.reply({ content: '🔄 Lancement forcé de la présence OP...', ephemeral: true });

    // Lancer la présence normalement (avec relances et crons)
    await sendPresenceMessage();

    console.log('🔄 /presence-force: Présence OP lancée manuellement');
}

async function handlePresence2(interaction) {
    await interaction.reply({ content: '📋 Envoi de la 2ème présence OP...', ephemeral: true });
    await sendPresence2Message();
}

async function sendPresence2Message(channelOverride) {
    const channelId = channelOverride || CONFIG.CHANNELS.PRESENCE;
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    // Heure Paris (pas UTC)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}H${String(now.getMinutes()).padStart(2, '0')}`;
    const itemsList = presenceItems.map(item => `- ${item}`).join('\n');

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
        await safeReact(msg, CONFIG.REACT_EMOJIS.CHECK);
        await safeReact(msg, CONFIG.REACT_EMOJIS.RETARD);
        await safeReact(msg, CONFIG.REACT_EMOJIS.NO);

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
            presence2Data = { messageId: null, active: false }; reactionsOP2.clear(); savePresenceState();
            await refreshAbsencePanel();
        }, 30 * 60 * 1000);
    } catch (error) {
        console.error('❌ Erreur 2ème OP:', error);
    }
}

async function handlePresenceTest2(interaction) {
    presence2Data = { messageId: null, active: false }; reactionsOP2.clear(); savePresenceState();
    await interaction.reply({ content: '🧪 Test 2ème présence OP...', ephemeral: true });
    await sendPresence2Message(CONFIG.CHANNELS.COMMANDES);
}

// ==========================================
// Alertes simples
// ==========================================
async function handleSimpleAlert(interaction, message, mentionRoles = false) {
    await interaction.reply({ content: '🚨 Envoi...', ephemeral: true });
    const channel = client.channels.cache.get(CONFIG.CHANNELS.QG);
    if (!channel) return interaction.editReply('❌ Salon QG introuvable');

    const sent = [];
    const opts = mentionRoles ? { content: message, allowedMentions: { parse: ['roles'] } } : message;

    for (let i = 0; i < 15; i++) {
        sent.push(await channel.send(opts));
        await sleep(TIMERS.QG_MESSAGE_INTERVAL);
    }

    await interaction.editReply(`✅ ${sent.length} alertes envoyées`);
    setTimeout(async () => { for (const m of sent) { await m.delete().catch(() => {}); await sleep(300); } }, TIMERS.QG_DELETE_DELAY);
}

// ==========================================
// /radio
// ==========================================
async function handleRadio(interaction) {
    const channel = client.channels.cache.get(CONFIG.CHANNELS.RADIO);
    if (!channel) {
        try { await interaction.reply({ content: '❌ Salon radio introuvable', ephemeral: true }); } catch {}
        return;
    }

    const freq = `${String(Math.floor(Math.random() * 98) + 1).padStart(2, '0')}.${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;

    // Réponse immédiate à l'interaction
    try {
        await interaction.reply({ content: `✅ Radio : **${freq}**`, ephemeral: true });
    } catch (e) {
        console.error('❌ /radio reply erreur:', e.message);
        return;
    }

    // Suppression des anciens messages radio du bot + envoi du nouveau
    (async () => {
        try {
            // Scanner les 50 derniers messages du salon pour supprimer les anciennes radios du bot
            // Cela couvre le cas du redéploiement où lastRadioMessageId est perdu
            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            if (messages) {
                const oldRadios = messages.filter(m =>
                    m.author.id === client.user.id &&
                    m.content.includes('Voici la nouvelle Radio')
                );
                for (const [, m] of oldRadios) {
                    await m.delete().catch(() => {});
                    await sleep(200);
                }
                if (oldRadios.size > 0) {
                    console.log(`🗑️ ${oldRadios.size} ancienne(s) radio(s) supprimée(s)`);
                }
            }
        } catch (e) {
            console.error('❌ Cleanup radios:', e.message);
        }

        try {
            const msg = await channel.send({
                content: `Voici la nouvelle Radio <@&${CONFIG.ROLES.MEMBRE_1}> : **${freq}**\nMerci de vous connecter dessus ! ${CONFIG.EMOJIS.BS21}`,
                allowedMentions: { parse: ['roles'] }
            });
            lastRadioMessageId = msg.id;
        } catch (e) {
            console.error('❌ /radio envoi erreur:', e.message);
        }
    })();
}

// ==========================================
// /presence-test
// ==========================================
async function handlePresenceTest(interaction) {
    if (presenceData.reminderInterval) clearInterval(presenceData.reminderInterval);
    presenceData = { messageId: null, reminderIds: [], reminderInterval: null, active: false };
    reactionsOP1.clear();
    savePresenceState();
    await interaction.reply({ content: '🧪 Test 1ère présence OP...', ephemeral: true });
    await sendPresenceMessage(CONFIG.CHANNELS.COMMANDES);
}

// ==========================================
// /presence-edit
// ==========================================
async function handlePresenceEdit(interaction) {
    const liste = interaction.options.getString('liste');
    if (!liste) {
        return interaction.reply({ content: `📋 **Liste :**\n${presenceItems.map((x, i) => `${i + 1}. ${x}`).join('\n')}`, ephemeral: true });
    }
    const items = liste.split('/').map(x => x.trim()).filter(x => x);
    if (!items.length) return interaction.reply({ content: '❌ Vide.', ephemeral: true });
    presenceItems = items;
    await interaction.reply({ content: `✅ Mis à jour !\n${items.map((x, i) => `${i + 1}. ${x}`).join('\n')}`, ephemeral: true });
}

// ==========================================
// /annonce
// ==========================================
async function handleAnnonce(interaction) {
    const role = interaction.options.getRole('role');
    const msg = interaction.options.getString('message').replace(/\\n/g, '\n');
    const ch = client.channels.cache.get(CONFIG.CHANNELS.BM_NOTIF);
    if (!ch) return interaction.reply({ content: '❌ Salon introuvable', ephemeral: true });

    await ch.send({ content: `${msg}\n\n||<@&${role.id}>||`, allowedMentions: { parse: ['roles'] } });
    await interaction.reply({ content: `✅ Annonce envoyée`, ephemeral: true });
}

// ==========================================
// /clear + /clearmessage
// ==========================================
async function handleClear(interaction) {
    try {
        await interaction.reply({ content: '🧹 Suppression en cours...', ephemeral: true });
    } catch (e) {
        console.error('❌ /clear reply:', e.message);
        return;
    }

    const limit = interaction.options.getInteger('nombre') || 100;

    try {
        const count = await clearBotMessages(interaction.channel, limit);
        await interaction.editReply(`🧹 ${count} message(s) du bot supprimé(s)`).catch(() => {});
    } catch (e) {
        console.error('❌ /clear erreur:', e.message);
        await interaction.editReply(`❌ Erreur : ${e.message}`).catch(() => {});
    }
}

async function handleClearMessage(interaction) {
    try {
        await interaction.reply({ content: '🧹 Suppression en cours...', ephemeral: true });
    } catch (e) {
        console.error('❌ /clearmessage reply:', e.message);
        return;
    }

    const nombre = interaction.options.getInteger('nombre');

    try {
        const msgs = await interaction.channel.messages.fetch({ limit: Math.min(nombre, 100) });
        const toDelete = msgs.filter(m => m.author.id !== '952986899667103804');

        // Séparer les messages récents (< 14 jours) des anciens
        const now = Date.now();
        const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
        const recent = [];
        const old = [];
        for (const [, m] of toDelete) {
            if (now - m.createdTimestamp < FOURTEEN_DAYS) recent.push(m);
            else old.push(m);
        }

        let deleted = 0;

        // Bulk delete pour les récents (plus rapide, pas de rate-limit)
        if (recent.length >= 2) {
            try {
                const bulk = await interaction.channel.bulkDelete(recent, true);
                deleted += bulk.size;
            } catch (e) {
                console.warn('⚠️ bulkDelete fallback:', e.message);
                // Fallback : un par un
                for (const m of recent) {
                    try { await m.delete(); deleted++; } catch {}
                    await sleep(300);
                }
            }
        } else if (recent.length === 1) {
            try { await recent[0].delete(); deleted++; } catch {}
        }

        // Anciens : un par un (Discord interdit le bulk pour > 14 jours)
        for (const m of old) {
            try { await m.delete(); deleted++; } catch {}
            await sleep(500);
        }

        await interaction.editReply(`🧹 ${deleted} message(s) supprimé(s)${old.length > 0 ? ` (dont ${old.length} > 14 jours)` : ''}`).catch(() => {});
    } catch (e) {
        console.error('❌ /clearmessage erreur:', e.message);
        await interaction.editReply(`❌ Erreur : ${e.message}`).catch(() => {});
    }
}

async function clearBotMessages(channel, limit) {
    let deleted = 0;
    const msgs = await channel.messages.fetch({ limit: Math.min(limit, 100) });
    const botMsgs = msgs.filter(m => m.author.id === client.user.id);

    if (botMsgs.size === 0) return 0;

    const now = Date.now();
    const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
    const recent = [];
    const old = [];
    for (const [, m] of botMsgs) {
        if (now - m.createdTimestamp < FOURTEEN_DAYS) recent.push(m);
        else old.push(m);
    }

    // Bulk delete pour les récents
    if (recent.length >= 2) {
        try {
            const bulk = await channel.bulkDelete(recent, true);
            deleted += bulk.size;
        } catch (e) {
            console.warn('⚠️ bulkDelete fallback:', e.message);
            for (const m of recent) {
                try { await m.delete(); deleted++; } catch {}
                await sleep(300);
            }
        }
    } else if (recent.length === 1) {
        try { await recent[0].delete(); deleted++; } catch {}
    }

    // Anciens : un par un
    for (const m of old) {
        try { await m.delete(); deleted++; } catch {}
        await sleep(500);
    }

    return deleted;
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
    const itemsList = presenceItems.map(x => `- ${x}`).join('\n');

    let text;
    if (customPresenceMessage) {
        text = customPresenceMessage
            .replace('{date}', dateStr)
            .replace('{emojis}', `${CONFIG.EMOJIS.CHECK} Présent ${CONFIG.EMOJIS.RETARD} Retard ${CONFIG.EMOJIS.NO} Absent`);
    } else {
        text = `<@&${CONFIG.ROLES.MEMBRE_1}>\n\n**Présence OP** du ${dateStr} à **21H00**\nSoyez présent à **20H45.**\n\n${itemsList}\n\nAucun oubli toléré ${CONFIG.EMOJIS.ATTENTION}\n\nAfin d'être prêt à partir en convoi une fois l'appel effectué.\nRéaction obligatoire : ${CONFIG.EMOJIS.CHECK} Présent ${CONFIG.EMOJIS.RETARD} Retard ${CONFIG.EMOJIS.NO} Absent\n\nMerci de mettre une absence dans le salon <#${CONFIG.CHANNELS.ABSENCE}> si vous n'êtes pas présent. Respecter la Template c'est **important** ${CONFIG.EMOJIS.ATTENTION}`;
    }

    try {
        const msg = await channel.send({ content: text, allowedMentions: { parse: ['roles'] } });
        await safeReact(msg, CONFIG.REACT_EMOJIS.CHECK);
        await safeReact(msg, CONFIG.REACT_EMOJIS.RETARD);
        await safeReact(msg, CONFIG.REACT_EMOJIS.NO);

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
let presenceCronsScheduled = false;

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
        presenceData.reminderInterval = setInterval(() => doReminder(false), TIMERS.PRESENCE_RAPPEL_INTERVAL);
    } else {
        // Empêcher les doublons : si les crons sont déjà programmés, on ne les recrée pas
        if (!presenceCronsScheduled) {
            ['0 18', '30 18', '0 19', '30 19', '0 20', '45 20'].forEach((t, i, a) => {
                cron.schedule(`${t} * * *`, () => {
                    if (presenceData.active && presenceData.messageId) doReminder(i === a.length - 1);
                }, { timezone: 'Europe/Paris' });
            });

            // 21h05 — Avertissements
            cron.schedule('5 21 * * *', async () => {
                stopped = true;
                if (presenceData.reminderInterval) { clearInterval(presenceData.reminderInterval); presenceData.reminderInterval = null; }
                if (!presenceData.active || !presenceData.messageId) return;
                await sendPresenceWarnings(channel);
                await refreshAbsencePanel();
            }, { timezone: 'Europe/Paris' });

            // 21h20 — Suppression message 1ère OP
            cron.schedule('20 21 * * *', async () => {
                if (!presenceData.messageId) return;
                console.log('🗑️ 21h20 : Suppression 1ère présence OP');
                try {
                    const msg = await channel.messages.fetch(presenceData.messageId);
                    await msg.delete();
                } catch {}
            }, { timezone: 'Europe/Paris' });

            // 22h00 — Nettoyage complet
            cron.schedule('0 22 * * *', async () => {
                if (!presenceData.active) return;
                stopAbsencePanelRefresh();
                await cleanupPresence(channel);

                if (presence2Data.messageId) {
                    try { const m = await channel.messages.fetch(presence2Data.messageId); await m.delete(); } catch {}
                }
                presence2Data = { messageId: null, active: false }; reactionsOP2.clear(); savePresenceState();
            }, { timezone: 'Europe/Paris' });

            presenceCronsScheduled = true;
            console.log('🔔 Crons présence programmés : rappels 18h-20h45, avertissements 21h05, suppression 21h20, cleanup 22h');
        }

        // Mode TEST/TURBO : on lance des crons * * * * * temporaires
        if (TEST_MODE || TURBO_MODE) {
            cron.schedule('* * * * *', async () => {
                stopped = true;
                if (presenceData.reminderInterval) { clearInterval(presenceData.reminderInterval); presenceData.reminderInterval = null; }
                if (!presenceData.active || !presenceData.messageId) return;
                await sendPresenceWarnings(channel);
                await refreshAbsencePanel();
            }, { timezone: 'Europe/Paris' });
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
        const msgs = await ch.messages.fetch({ limit: 100 });
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
    } catch {}
    return { validAbsences, invalidAbsences, validAbsenceNames, invalidAbsenceNames };
}

async function cleanupPresence(channel) {
    try {
        for (const id of presenceData.reminderIds) { try { const m = await channel.messages.fetch(id); await m.delete(); } catch {} await sleep(300); }
        if (presenceData.messageId) { try { const m = await channel.messages.fetch(presenceData.messageId); await m.delete(); } catch {} }
        const msgs = await channel.messages.fetch({ limit: 50 });
        for (const [, m] of msgs.filter(m => m.author.id === client.user.id)) { await m.delete().catch(() => {}); await sleep(300); }
        presenceData = { messageId: null, reminderIds: [], reminderInterval: null, active: false }; reactionsOP1.clear(); savePresenceState();
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
                const t = absenceTracking.get(member.id) || { count: 0, dates: [], details: [], username: '' };
                t.count++;
                t.dates.push(`${todayStr} (1ère OP)`);
                t.details = t.details || [];
                t.details.push({ date: todayStr, op: '1ère Présence OP', justified: false });
                t.username = member.nickname || member.user.username;
                absenceTracking.set(member.id, t);

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

                    const t = absenceTracking.get(member.id) || { count: 0, dates: [], details: [], username: '' };
                    t.details = t.details || [];
                    t.details.push({ date: todayStr, op: '1ère Présence OP', justified: false, reason: 'Template non conforme' });
                    t.username = member.nickname || member.user.username;
                    absenceTracking.set(member.id, t);

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

            // Reset pour ceux qui ont réagi
            for (const uid of reacted) absenceTracking.delete(uid);
            saveAbsenceTracking();
        }

        // === 2ème OP ===
        if (presence2Data.active && presence2Data.messageId) {
            const { noReact, reacted } = processOP('2ème Présence OP', reactionsOP2);

            for (const member of noReact) {
                const t = absenceTracking.get(member.id) || { count: 0, dates: [], details: [], username: '' };
                t.count++;
                t.dates.push(`${todayStr} (2ème OP)`);
                t.details = t.details || [];
                t.details.push({ date: todayStr, op: '2ème Présence OP', justified: false });
                t.username = member.nickname || member.user.username;
                absenceTracking.set(member.id, t);

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

            for (const uid of reacted) absenceTracking.delete(uid);
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

const REMINDERS_FILE = '/data/reminders.json';
let reminders = [];
let nextReminderId = 1;
let reminderLoopTimer = null;
let panelMessageId = null;
let panelChannelId = null;

// Persistance des rappels
function loadReminders() {
    try {
        if (fs.existsSync(REMINDERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
            reminders = data.reminders || [];
            nextReminderId = data.nextId || 1;
            console.log(`📋 ${reminders.length} rappel(s) restauré(s)`);
        }
    } catch (e) {
        console.error('❌ Erreur chargement rappels:', e.message);
    }
}

function saveReminders() {
    try {
        fs.writeFileSync(REMINDERS_FILE, JSON.stringify({ reminders, nextId: nextReminderId }, null, 2));
    } catch (e) {
        console.error('❌ Erreur sauvegarde rappels:', e.message);
    }
}

function formatPanelMessage(text) {
    let result = text.replace(/\\n/g, '\n');
    for (const [shortcut, full] of Object.entries(PANEL_CONFIG.EMOJI_SHORTCUTS)) {
        result = result.replaceAll(shortcut, full);
    }
    result = result.replace(/(?<!<[#@!&a-z:])(\d{17,20})(?![>:\w])/g, '<#$1>');
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

        const toSend = reminders.filter(r => r.enabled && elapsed % r.interval === 0);
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

// ==========================================
// FILTRE SALON CLIPS — videos uniquement
// ==========================================
const VIDEO_URL_REGEX = /https?:\/\/[^\s]+\.(mp4|mov|avi|webm|mkv)|https?:\/\/(www\.)?(youtube\.com|youtu\.be|twitch\.tv|clips\.twitch\.tv|streamable\.com|medal\.tv|tiktok\.com|vm\.tiktok\.com|x\.com|twitter\.com|instagram\.com|facebook\.com|fb\.watch|dailymotion\.com|vimeo\.com|kick\.com)/i;

client.on('messageCreate', async (message) => {
    if (message.channelId !== CONFIG.CHANNELS.CLIPS) return;
    if (message.author.bot) return;
    if (message.author.id === PANEL_CONFIG.PROTECTED_USER_ID) return;

    const hasVideoLink = VIDEO_URL_REGEX.test(message.content);
    const hasVideoAttachment = message.attachments.some(a => a.contentType && a.contentType.startsWith('video/'));

    if (!hasVideoLink && !hasVideoAttachment) {
        try {
            await message.delete();
            const warn = await message.channel.send(
                `${message.author} ❌ Seuls les liens vidéo / clips sont autorisés ici.`
            );
            setTimeout(() => warn.delete().catch(() => {}), 5000);
        } catch {}
    }
});

// ==========================================
// VALIDATEUR FORMAT ABSENCE
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.channelId !== CONFIG.CHANNELS.ABSENCE) return;
    if (message.author.bot) return;

    const c = message.content;

    // Vérification des 4 champs obligatoires
    const hasNom = /Nom\s*:/i.test(c);
    const hasPrenom = /Pr[ée]nom\s*:/i.test(c);
    const hasDate = /Date\(?s?\)?\s*:/i.test(c);
    const hasRaison = /Raison\s*:/i.test(c);

    const isValid = hasNom && hasPrenom && hasDate && hasRaison;

    if (!isValid) {
        // Construire la liste des éléments manquants
        const missing = [];
        if (!hasNom) missing.push('**Nom**');
        if (!hasPrenom) missing.push('**Prénom**');
        if (!hasDate) missing.push('**Date(s)**');
        if (!hasRaison) missing.push('**Raison**');

        try {
            const warn = await message.channel.send(
                `${message.author} ${CONFIG.EMOJIS.ATTENTION} Ton absence n'est **pas conforme** au format demandé.\n` +
                `\n📋 Élément(s) manquant(s) ou mal formaté(s) : ${missing.join(', ')}\n` +
                `\n**Format à respecter :**\n` +
                `\`\`\`\n` +
                `Nom : Fayy\n` +
                `Prénom : Nino\n` +
                `Date(s) : 05/04 - 07/04\n` +
                `Raison : En weekend\n` +
                `\`\`\`\n` +
                `Merci de **refaire un message** en respectant ce format. ${CONFIG.EMOJIS.BS21}`
            );
            // L'avertissement reste 60 secondes pour laisser le temps de lire
            setTimeout(() => warn.delete().catch(() => {}), 60_000);
        } catch (e) {
            console.error('❌ Erreur warn absence:', e.message);
        }
        return;
    }

    // Format valide → vérifier que la date a un format compréhensible
    const dm = c.match(/Date\(?s?\)?\s*:\s*(.+)/i);
    if (dm) {
        const ds = dm[1].trim();
        const hasRange = /(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/.test(ds);
        const hasSingle = /(\d{1,2})\/(\d{1,2})/.test(ds);

        if (!hasRange && !hasSingle) {
            try {
                const warn = await message.channel.send(
                    `${message.author} ${CONFIG.EMOJIS.ATTENTION} Ton format de **date** n'est pas reconnu.\n` +
                    `\n**Exemples acceptés :**\n` +
                    `• \`Date(s) : 05/04\` (un seul jour)\n` +
                    `• \`Date(s) : 05/04 - 07/04\` (plage de jours)\n` +
                    `\nMerci de corriger ton message ${CONFIG.EMOJIS.BS21}`
                );
                setTimeout(() => warn.delete().catch(() => {}), 60_000);
            } catch {}
        }
    }
});



async function safeReact(msg, emoji, retries = 2) {
    // Si format "name:id", on extrait l'ID seul (Discord accepte juste l'ID pour les emojis custom)
    let toReact = emoji;
    const match = typeof emoji === 'string' ? emoji.match(/^(\w+):(\d+)$/) : null;
    if (match) toReact = match[2]; // Juste l'ID de l'emoji

    for (let i = 0; i <= retries; i++) {
        try {
            await msg.react(toReact);
            await sleep(500);
            return true;
        } catch (err) {
            console.warn(`⚠️ safeReact échec (${emoji}, tentative ${i + 1}/${retries + 1}):`, err.message);
            if (i < retries) await sleep(1000);
        }
    }
    console.error(`❌ safeReact ABANDONNÉ pour emoji: ${emoji}`);
    return false;
}

// ==========================================
// ERREURS
// ==========================================
process.on('unhandledRejection', e => console.error('❌ Unhandled:', e));
process.on('uncaughtException', e => console.error('❌ Uncaught:', e));

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
        absenceSalonCache,
        sendPresenceMessage,
        sendPresence2Message,
        getAbsentUsersToday,
        updateAbsenceSalonCache,
        getConsecutiveDays,
        saveAbsenceTracking,
    };
}

module.exports = { client, getBotState };
