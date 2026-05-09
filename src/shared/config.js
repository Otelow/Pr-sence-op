const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const DATA_DIR = process.env.DATA_DIR
    || process.env.RAILWAY_VOLUME_MOUNT_PATH
    || (isRailway ? '/data' : path.join(ROOT_DIR, 'data'));

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
        public: path.join(ROOT_DIR, 'public')
    },
    discord: {
        token: process.env.DISCORD_TOKEN || '',
        guildId: process.env.GUILD_ID || '',
        clientId: process.env.DISCORD_CLIENT_ID || ''
    },
    web: {
        port: Number(process.env.PORT || 3000),
        sessionSecret: process.env.SESSION_SECRET || 'change-me-local',
        sessionMaxAgeMs: Number(process.env.SESSION_MAX_AGE_MS || 10 * 60 * 1000)
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
    timeouts: {
        requestMs: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
        discordMs: Number(process.env.DISCORD_TIMEOUT_MS || 15000)
    }
};

module.exports = config;
