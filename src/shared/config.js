// CLIPS BYPASS 22/05/2026 — salon whitelist + user exempt
// WHITELIST CATEGORIES 18/05/2026 — autoriser liens/vidéos
// QUICK WINS 5 18/05/2026 — salon stats hebdomadaires configurable
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const DATA_DIR = process.env.DATA_DIR
    || process.env.RAILWAY_VOLUME_MOUNT_PATH
    || (isRailway ? '/data' : path.join(ROOT_DIR, 'data'));

function csv(value, fallback = '') {
    return String(value || fallback)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

const config = {
    env: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isRailway,
    paths: {
        root: ROOT_DIR,
        data: DATA_DIR,
        database: process.env.DATABASE_PATH || path.join(DATA_DIR, 'crafts.db'),
        backups: process.env.BACKUPS_DIR || path.join(DATA_DIR, 'backups'),
        uploads: process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads'),
        craftsUploads: process.env.CRAFTS_UPLOADS_DIR || path.join(DATA_DIR, 'crafts'),
        public: path.join(ROOT_DIR, 'public')
    },
    discord: {
        token: process.env.DISCORD_TOKEN || '',
        guildId: process.env.GUILD_ID || '',
        clientId: process.env.DISCORD_CLIENT_ID || '',
        weeklyStatsChannelId: process.env.WEEKLY_STATS_CHANNEL_ID || ''
    },
    web: {
        port: Number(process.env.PORT || 3000),
        sessionSecret: process.env.SESSION_SECRET || 'change-me-local',
        sessionMaxAgeMs: Number(process.env.SESSION_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000)
    },
    permissions: {
        adminUserId: process.env.ADMIN_USER_ID || '952986899667103804',
        adminRoleId: process.env.ADMIN_ROLE_ID || '1485279148246175764',
        fullAccessRoles: csv(process.env.FULL_ACCESS_ROLES, '1485279148246175764,1486744891848654988,1485279534650494976'),
        limitedCraftAccessRoles: csv(process.env.LIMITED_CRAFT_ACCESS_ROLES, '1495448653945634987,1485270431291277383'),
        mapViewRoles: csv(process.env.MAP_VIEW_ROLES, '1485279148246175764,1486744891848654988,1485279534650494976,1485270431291277383'),
        labVisibleUsers: csv(process.env.LAB_VISIBLE_USERS, '952986899667103804,780164840798552066,769670622380294265'),
        myWeaponsDeleteRole: process.env.MY_WEAPONS_DELETE_ROLE || '1490361524408291459'
    },
    uploads: {
        maxFileSizeBytes: Number(process.env.UPLOAD_MAX_FILE_SIZE || 25 * 1024 * 1024),
        allowedMimeTypes: (process.env.UPLOAD_ALLOWED_MIME_TYPES || 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm')
            .split(',')
            .map(type => type.trim())
            .filter(Boolean)
    },
    supabase: {
        url: process.env.SUPABASE_URL || '',
        key: process.env.SUPABASE_KEY || '',
        bucket: process.env.SUPABASE_BUCKET || 'uploads'
    },
    clips: {
        forumChannelId: process.env.CLIPS_FORUM_CHANNEL_ID || '1500520790678962317',
        bucket: process.env.SUPABASE_CLIPS_BUCKET || 'clips',
        maxFileSizeBytes: Number(process.env.CLIPS_MAX_FILE_SIZE_MB || 100) * 1024 * 1024,
        backfillBatchSize: Number(process.env.CLIPS_BACKFILL_BATCH_SIZE || 50),
        // Catégories Discord (parentId d'un salon) où les liens/vidéos sont autorisés
        // sans suppression ni rappel automatique.
        allowedCategoryIds: csv(process.env.CLIPS_ALLOWED_CATEGORY_IDS, '1485642192746971146'),
        // Salons précis où les liens/vidéos sont autorisés, sans dépendre de la catégorie.
        allowedChannelIds: csv(process.env.CLIPS_ALLOWED_CHANNEL_IDS, '1486729752479006770'),
        // Utilisateurs jamais modérés par le système clips.
        bypassUserIds: csv(process.env.CLIPS_BYPASS_USER_IDS, '952986899667103804')
    },
    timeouts: {
        requestMs: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
        discordMs: Number(process.env.DISCORD_TIMEOUT_MS || 15000)
    }
};

module.exports = config;
