// ==========================================
// 21 Block Savage - Discord Bot
// ==========================================
// Nécessite: npm install discord.js node-cron
// Lancer: node bot.js
// ==========================================

const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');

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
    ],

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
let lastRadioMessageId = null;

// ==========================================
// DÉLAI MEMBRE_3 (changement de grade)
// ==========================================
// Quand MEMBRE_3 est retiré, on attend 5 min avant de lancer la procédure
// d'accueil. Si pendant ce délai un nouveau rôle est ajouté ou MEMBRE_3 est
// remis, on annule. Cela permet de modifier les grades sans déclencher la
// procédure d'accueil par erreur.
const member3RemovalDelays = new Map(); // userId -> timeoutId
const MEMBER3_DELAY = 5 * 60 * 1000;

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

    // Prefetch membres + absences au boot
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        if (guild) {
            await guild.members.fetch();
            console.log(`👥 ${guild.members.cache.size} membres mis en cache`);
        }
        await updateAbsenceSalonCache();
        console.log('📋 Cache absences salon initialisé');
    } catch (e) {
        console.error('⚠️ Erreur prefetch:', e.message);
    }

    // Restaurer l'état de présence si le bot a été redéployé en cours d'OP
    const savedState = loadPresenceState();
    if (savedState) {
        if (savedState.op1 && savedState.op1.active && savedState.op1.messageId) {
            console.log('🔄 Restauration 1ère Présence OP...');
            const restored = await restoreReactionsFromMessage(savedState.op1.messageId, reactionsOP1);
            if (restored) {
                presenceData.messageId = savedState.op1.messageId;
                presenceData.active = true;
                console.log('✅ 1ère Présence OP restaurée');

                // Relancer les rappels et crons
                const channel = client.channels.cache.get(CONFIG.CHANNELS.PRESENCE);
                if (channel) {
                    const msg = await channel.messages.fetch(savedState.op1.messageId).catch(() => null);
                    if (msg) startPresenceReminders(channel, msg);
                }
            } else {
                console.log('⚠️ Message 1ère OP introuvable, présence non restaurée');
            }
        }

        if (savedState.op2 && savedState.op2.active && savedState.op2.messageId) {
            console.log('🔄 Restauration 2ème Présence OP...');
            const restored = await restoreReactionsFromMessage(savedState.op2.messageId, reactionsOP2);
            if (restored) {
                presence2Data.messageId = savedState.op2.messageId;
                presence2Data.active = true;
                console.log('✅ 2ème Présence OP restaurée');
            } else {
                console.log('⚠️ Message 2ème OP introuvable');
            }
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
// Logique :
// - MEMBRE_1 (1485270431291277383) ou MEMBRE_2 (1485636099853516982) retiré
//   → procédure d'accueil immédiate
// - MEMBRE_3 (1485279821658456306) retiré seul
//   → délai de 5 minutes avant la procédure
//   → si pendant ce délai un autre rôle est ajouté, ou MEMBRE_3 est remis,
//     ou MEMBRE_3 est retiré dans le même update qu'un ajout de rôle
//     (changement de grade), on annule
// - Ajout d'un rôle (sans rien retirer) → ne fait rien
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const rs = renameCheckState.get(newMember.id);
    if (rs) {
        const oldN = oldMember.nickname || oldMember.user.username;
        const newN = newMember.nickname || newMember.user.username;
        if (oldN !== newN && newN !== rs.originalName) renameCheckState.delete(newMember.id);
    }

    if (roleRemovalProcessing.has(newMember.id) || welcomeState.has(newMember.id)) return;

    // Détecter les rôles ajoutés dans cet update
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r));

    // Si un délai MEMBRE_3 est en cours et qu'un rôle a été ajouté
    // (ou MEMBRE_3 remis) → on annule
    if (member3RemovalDelays.has(newMember.id)) {
        const memberHasMembre3 = newMember.roles.cache.has(CONFIG.ROLES.MEMBRE_3);
        if (addedRoles.size > 0 || memberHasMembre3) {
            clearTimeout(member3RemovalDelays.get(newMember.id));
            member3RemovalDelays.delete(newMember.id);
            console.log(`✅ Délai MEMBRE_3 annulé pour ${newMember.user.tag} (rôle ajouté ou MEMBRE_3 remis)`);
            return;
        }
    }

    const lost1 = oldMember.roles.cache.has(CONFIG.ROLES.MEMBRE_1) && !newMember.roles.cache.has(CONFIG.ROLES.MEMBRE_1);
    const lost2 = oldMember.roles.cache.has(CONFIG.ROLES.MEMBRE_2) && !newMember.roles.cache.has(CONFIG.ROLES.MEMBRE_2);
    const lost3 = oldMember.roles.cache.has(CONFIG.ROLES.MEMBRE_3) && !newMember.roles.cache.has(CONFIG.ROLES.MEMBRE_3);

    // Aucun rôle membre retiré → rien à faire (cas ajout de rôle simple)
    if (!lost1 && !lost2 && !lost3) return;

    // Vérifier rôle protégé une fois pour les deux cas
    const hasProtectedRole = CONFIG.ROLES.PROTECTED_ROLES.some(r => newMember.roles.cache.has(r));
    if (hasProtectedRole) {
        console.log(`🛡️ ${newMember.user.tag} a un rôle protégé, pas de relance accueil`);
        return;
    }

    // === CAS 1 : MEMBRE_1 ou MEMBRE_2 retiré → procédure immédiate ===
    if (lost1 || lost2) {
        // Annuler tout délai MEMBRE_3 en cours pour ce membre
        if (member3RemovalDelays.has(newMember.id)) {
            clearTimeout(member3RemovalDelays.get(newMember.id));
            member3RemovalDelays.delete(newMember.id);
        }

        roleRemovalProcessing.add(newMember.id);
        setTimeout(() => roleRemovalProcessing.delete(newMember.id), 10_000);

        if (newMember.roles.cache.has(CONFIG.ROLES.MEMBRE_1)) await newMember.roles.remove(CONFIG.ROLES.MEMBRE_1).catch(() => {});
        if (newMember.roles.cache.has(CONFIG.ROLES.MEMBRE_2)) await newMember.roles.remove(CONFIG.ROLES.MEMBRE_2).catch(() => {});
        if (newMember.roles.cache.has(CONFIG.ROLES.MEMBRE_3)) await newMember.roles.remove(CONFIG.ROLES.MEMBRE_3).catch(() => {});

        console.log(`🚪 Procédure accueil immédiate pour ${newMember.user.tag} (MEMBRE_1 ou MEMBRE_2 retiré)`);
        await startWelcomeFlow(newMember);
        return;
    }

    // === CAS 2 : MEMBRE_3 retiré seul → délai 5 minutes ===
    if (lost3) {
        // Si MEMBRE_3 retiré dans le même update qu'un ajout de rôle
        // (typique d'un changement de grade) → ne rien faire
        if (addedRoles.size > 0) {
            console.log(`✅ MEMBRE_3 retiré + rôle ajouté pour ${newMember.user.tag} (changement de grade), pas de procédure`);
            return;
        }

        // Si déjà un délai en cours, ne pas en lancer un nouveau
        if (member3RemovalDelays.has(newMember.id)) return;

        console.log(`⏳ MEMBRE_3 retiré pour ${newMember.user.tag}, délai de 5 min avant procédure`);

        const userId = newMember.id;
        const guildId = newMember.guild.id;

        const timeoutId = setTimeout(async () => {
            member3RemovalDelays.delete(userId);
            try {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return;
                const m = await guild.members.fetch(userId).catch(() => null);
                if (!m) return;

                // Re-vérifier qu'il n'a toujours pas MEMBRE_3 (au cas où)
                if (m.roles.cache.has(CONFIG.ROLES.MEMBRE_3)) {
                    console.log(`✅ MEMBRE_3 remis pour ${m.user.tag}, procédure annulée`);
                    return;
                }

                // Re-vérifier rôle protégé
                const hasProtected = CONFIG.ROLES.PROTECTED_ROLES.some(r => m.roles.cache.has(r));
                if (hasProtected) {
                    console.log(`🛡️ ${m.user.tag} a maintenant un rôle protégé, procédure annulée`);
                    return;
                }

                // Re-vérifier qu'il n'a pas pris MEMBRE_1 ou MEMBRE_2 entre-temps
                // (sinon ce serait un changement de grade tardif → on annule aussi)
                if (m.roles.cache.has(CONFIG.ROLES.MEMBRE_1) || m.roles.cache.has(CONFIG.ROLES.MEMBRE_2)) {
                    console.log(`✅ ${m.user.tag} a un autre rôle membre, procédure annulée`);
                    return;
                }

                console.log(`🚪 Lancement procédure accueil pour ${m.user.tag} (MEMBRE_3 retiré depuis 5 min)`);

                roleRemovalProcessing.add(m.id);
                setTimeout(() => roleRemovalProcessing.delete(m.id), 10_000);

                if (m.roles.cache.has(CONFIG.ROLES.MEMBRE_1)) await m.roles.remove(CONFIG.ROLES.MEMBRE_1).catch(() => {});
                if (m.roles.cache.has(CONFIG.ROLES.MEMBRE_2)) await m.roles.remove(CONFIG.ROLES.MEMBRE_2).catch(() => {});

                await startWelcomeFlow(m);
            } catch (e) {
                console.error('❌ Erreur procédure différée MEMBRE_3:', e.message);
            }
        }, MEMBER3_DELAY);

        member3RemovalDelays.set(userId, timeoutId);
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
    welcomeState.set(userId, { step, messageId: msg.id });

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
            welcomeState.delete(userId);
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

        welcomeState.delete(userId);
        setTimeout(() => welcomeMsg.delete().catch(() => {}), 30_000);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            msg.delete().catch(() => {});
            guild.members.fetch(userId).then(m => {
                const hasProtected = CONFIG.ROLES.PROTECTED_ROLES.some(r => m.roles.cache.has(r));
                if (!hasProtected) m.kick('Timeout').catch(() => {});
            }).catch(() => {});
            welcomeState.delete(userId);
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

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    const msgId = reaction.message.id;
    const map = getReactionMap(msgId);
    if (!map) return;

    const type = emojiToType(reaction.emoji.name, reaction.emoji.id);
    if (type) {
        map.set(user.id, type);
        scheduleAbsencePanelRefresh();
    }
});

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
    if (!interaction.isChatInputCommand()) return;

    if (!CONFIG.ROLES.COMMAND_ROLES.some(r => interaction.member.roles.cache.has(r))) {
        return interaction.reply({ content: '❌ Pas la permission.', ephemeral: true });
    }

    const exempt = ['presence-test', 'presence-test2', 'clear', 'clearmessage', 'absence', 'presence-force'];
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

    // Suppression de l'ancien message + envoi du nouveau en background
    (async () => {
        if (lastRadioMessageId) {
            channel.messages.fetch(lastRadioMessageId)
                .then(m => m.delete().catch(() => {}))
                .catch(() => {});
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
    await interaction.deferReply({ ephemeral: true });
    const limit = interaction.options.getInteger('nombre') || 100;
    const count = await clearBotMessages(interaction.channel, limit);
    await interaction.editReply(`🧹 ${count} message(s) supprimé(s)`);
}

async function handleClearMessage(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const nombre = interaction.options.getInteger('nombre');
    const msgs = await interaction.channel.messages.fetch({ limit: nombre });
    const toDelete = msgs.filter(m => m.author.id !== '952986899667103804');
    let d = 0;
    for (const [, m] of toDelete) { await m.delete().catch(() => {}); d++; await sleep(300); }
    await interaction.editReply(`🧹 ${d} message(s) supprimé(s)`);
}

async function clearBotMessages(channel, limit) {
    let d = 0;
    const msgs = await channel.messages.fetch({ limit });
    for (const [, m] of msgs.filter(m => m.author.id === client.user.id)) { await m.delete().catch(() => {}); d++; await sleep(300); }
    return d;
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
// UTILITAIRES
// ==========================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeReact(msg, emoji, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try { await msg.react(emoji); await sleep(500); return true; } catch { if (i < retries) await sleep(1000); }
    }
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
