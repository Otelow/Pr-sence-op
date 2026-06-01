// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes référentiels Discord isolées

// FINAL POST-STAB F 17/05/2026 — cache membres Discord côté serveur
const { getCachedMembers } = require('../services/membersCache');

const COMMANDS = [
    // Alertes terrain
    { id: 'qg', icon: '📍', name: 'QG', desc: 'Rendez-vous au Hood (5 min)', category: 'alert', danger: true },
    { id: 'defense', icon: '🔥', name: 'Défense Labo', desc: 'Laboratoire attaqué', category: 'alert', danger: true },
    { id: 'garage', icon: '🏗', name: 'Garage', desc: 'Rendez-vous au Garage Hood', category: 'alert' },
    { id: 'alignement', icon: '📐', name: 'Alignement', desc: '3 minutes pour s\'aligner', category: 'alert' },
    { id: 'position', icon: '🎯', name: 'Positions', desc: 'Prendre des positions', category: 'alert' },
    { id: 'tir', icon: '✋', name: 'Stop Tir', desc: 'Arrêter de tirer', category: 'alert' },
    { id: 'weed', icon: '🌿', name: 'Weed', desc: 'Aller sur la weed', category: 'alert' },
    { id: 'traitement-weed', icon: '⚗', name: 'Traitement', desc: 'Traitement de la weed', category: 'alert' },
    { id: 'yellowjack', icon: '🟡', name: 'Yellow Jack', desc: 'Rassemblement Yellow Jack', category: 'alert' },
    { id: 'megamall', icon: '🅿', name: 'Mega Mall', desc: 'Parking Mega Mall', category: 'alert' },
    { id: 'parking5', icon: 'P5', name: 'Parking 5', desc: 'Rassemblement Parking 5 Madrazo', category: 'alert', danger: true },
    { id: 'ile', icon: '🏝', name: 'Ile', desc: 'Rassemblement près de l’Ile', category: 'alert' },
    { id: 'trash', icon: '🚫', name: 'Anti-Trash', desc: 'Avertissement trash', category: 'alert' },
    // Communications
    { id: 'radio', icon: '📻', name: 'Nouvelle Radio', desc: 'Fréquence aléatoire', category: 'comm', info: true },
    { id: 'presence', icon: '📋', name: '1ère Présence OP', desc: 'Lancer sans relances auto', category: 'comm', info: true },
    { id: 'presence-stop', icon: '⏹', name: 'Stop 1ère Présence OP', desc: 'Arrêter le suivi actif', category: 'comm', danger: true },
    { id: 'presence2', icon: '📋', name: '2ème Présence OP', desc: 'Sans relances', category: 'comm', info: true },
    { id: 'presence2-stop', icon: '⏹', name: 'Stop 2ème Présence OP', desc: 'Arrêter le suivi actif', category: 'comm', danger: true },
];

function getGuild(getBotClient, getBotState) {
    const client = getBotClient();
    const state = getBotState();
    return client?.guilds?.cache?.get(state.CONFIG.GUILD_ID) || null;
}

function getMemberAvatar(member, size = 32) {
    return member.user.avatar
        ? `https://cdn.discordapp.com/avatars/${member.id}/${member.user.avatar}.png?size=${size}`
        : null;
}

function registerDirectoryRoutes(app, deps) {
    const {
        requireAuth,
        getBotClient,
        getBotState,
    } = deps;

    app.get('/api/members/search', requireAuth, async (req, res) => {
        const query = (req.query.q || '').toLowerCase().trim();
        if (query.length < 1) return res.json({ members: [] });

        const guild = getGuild(getBotClient, getBotState);
        if (!guild) return res.json({ members: [] });
        const membersCache = await getCachedMembers(guild).catch(() => guild.members.cache);

        const members = [...membersCache.values()]
            .filter(member => !member.user.bot)
            .filter(member => {
                const name = (member.nickname || member.user.username).toLowerCase();
                return name.includes(query);
            })
            .slice(0, 10)
            .map(member => ({
                id: member.id,
                name: member.nickname || member.user.username,
                avatar: getMemberAvatar(member),
            }));

        res.json({ members });
    });

    app.get('/api/members/all', requireAuth, async (req, res) => {
        const guild = getGuild(getBotClient, getBotState);
        if (!guild) return res.json({ members: [] });

        try {
            const membersCache = await getCachedMembers(guild).catch(() => guild.members.cache);

            const members = [...membersCache.values()]
                .filter(member => !member.user.bot)
                .map(member => ({
                    id: member.id,
                    name: member.nickname || member.user.username,
                    username: member.user.username,
                    avatar: getMemberAvatar(member),
                    color: member.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
                }))
                .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

            res.json({ members });
        } catch (e) {
            res.json({ members: [], error: e.message });
        }
    });

    app.get('/api/commands', requireAuth, (req, res) => {
        res.json({ commands: COMMANDS });
    });

    app.get('/api/roles', requireAuth, (req, res) => {
        const guild = getGuild(getBotClient, getBotState);
        if (!guild) return res.json({ roles: [] });

        const roles = [...guild.roles.cache.values()]
            .filter(role => role.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(role => ({
                id: role.id,
                name: role.name,
                color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : null,
                position: role.position,
                memberCount: role.members.size,
                mentionable: role.mentionable,
                managed: role.managed,
            }));

        res.json({ roles });
    });

    app.get('/api/emojis', requireAuth, (req, res) => {
        const guild = getGuild(getBotClient, getBotState);
        if (!guild) return res.json({ emojis: [] });

        const emojis = [...guild.emojis.cache.values()].map(emoji => ({
            id: emoji.id,
            name: emoji.name,
            animated: emoji.animated,
            url: emoji.url,
            code: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
        }));

        res.json({ emojis });
    });
}

module.exports = {
    registerDirectoryRoutes,
    COMMANDS,
};
