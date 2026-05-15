// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
// MODIFIÉ CHANTIER 11 — 14/05/2026 — backups automatiques Railway /data

// FINAL D4 16/05/2026 — backup distant Supabase hebdomadaire
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('../../shared/config');
const { createConnection } = require('../../shared/database');
const supabase = require('../../shared/supabase');

const RETENTION_DAYS = 30;
const JSON_FILES = [
    'absence_tracking.json',
    'presence_state.json',
    'reminders.json',
    'welcome_state.json',
    'map_points.json',
];

let backupRunning = false;

function formatDateStamp(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

async function backupCraftDatabase(stamp) {
    if (!fs.existsSync(config.paths.database)) {
        log.warn(`[backup] DB absente, backup SQLite ignoré: ${config.paths.database}`);
        return null;
    }

    const target = path.join(config.paths.backups, `crafts-${stamp}.db`);
    const db = createConnection(config.paths.database);
    try {
        await db.backup(target);
        log.info(`[backup] SQLite sauvegardé: ${target}`);
        return target;
    } finally {
        db.close();
    }
}

function backupRuntimeJson(stamp) {
    const copied = [];
    for (const file of JSON_FILES) {
        const source = path.join(config.paths.data, file);
        if (!fs.existsSync(source)) continue;

        const parsed = path.parse(file);
        const target = path.join(config.paths.backups, `${parsed.name}-${stamp}${parsed.ext}`);
        fs.copyFileSync(source, target);
        copied.push(target);
        log.info(`[backup] JSON sauvegardé: ${target}`);
    }
    return copied;
}

function cleanupOldBackups(now = Date.now()) {
    if (!fs.existsSync(config.paths.backups)) return 0;

    const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deleted = 0;
    for (const entry of fs.readdirSync(config.paths.backups, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const filePath = path.join(config.paths.backups, entry.name);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs <= maxAgeMs) continue;
        fs.unlinkSync(filePath);
        deleted++;
        log.info(`[backup] Ancien backup supprimé: ${filePath}`);
    }
    return deleted;
}

async function pushLastBackupToSupabase() {
    if (!supabase.isSupabaseConfigured()) {
        log.info('💾 backup distant : Supabase non configuré, skip');
        return;
    }

    const backupDir = path.join(config.paths.data, 'backups');
    let files;
    try {
        files = fs.readdirSync(backupDir)
            .filter(file => file.startsWith('crafts-') && file.endsWith('.db'));
    } catch {
        log.warn('💾 backup distant : pas de dossier backups local');
        return;
    }

    if (!files.length) {
        log.info('💾 backup distant : aucun backup local à pousser');
        return;
    }

    const latest = files.sort().pop();
    const filePath = path.join(backupDir, latest);
    const buffer = fs.readFileSync(filePath);
    const bucket = process.env.SUPABASE_BACKUP_BUCKET || 'backups';
    const remotePath = `backups/${latest}`;

    try {
        await supabase.uploadFile(bucket, remotePath, buffer, {
            contentType: 'application/x-sqlite3',
            upsert: true,
        });
        log.info(`✅ backup distant Supabase OK : ${latest} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
    } catch (e) {
        log.warn(`⚠️ backup distant Supabase échoué : ${e.message}`);
        return;
    }

    if (typeof supabase.listFiles === 'function' && typeof supabase.deleteFile === 'function') {
        try {
            const remote = await supabase.listFiles(bucket, 'backups/');
            const cutoff = Date.now() - 28 * 24 * 60 * 60 * 1000;
            for (const file of (remote || [])) {
                if (file.created_at && new Date(file.created_at).getTime() < cutoff) {
                    await supabase.deleteFile(bucket, `backups/${file.name}`);
                    log.info(`🗑️ backup distant purgé : ${file.name}`);
                }
            }
        } catch (e) {
            log.warn(`⚠️ purge backups distants échouée : ${e.message}`);
        }
    }
}

async function runDailyBackup() {
    if (backupRunning) {
        log.warn('[backup] Backup déjà en cours, exécution ignorée');
        return;
    }

    backupRunning = true;
    try {
        fs.mkdirSync(config.paths.backups, { recursive: true });
        const stamp = formatDateStamp();
        const dbBackup = await backupCraftDatabase(stamp);
        const jsonBackups = backupRuntimeJson(stamp);
        const deleted = cleanupOldBackups();
        log.info(`[backup] Terminé — db=${dbBackup ? 1 : 0}, json=${jsonBackups.length}, purge=${deleted}`);
    } catch (e) {
        log.error('[backup] Échec backup automatique:', e.message);
    } finally {
        backupRunning = false;
    }
}

function scheduleDailyBackups() {
    cron.schedule('0 4 * * *', runDailyBackup, { timezone: 'Europe/Paris' });
    log.info('[backup] Cron daily 04h00 Europe/Paris programmé');
    cron.schedule('0 5 * * 0', () => {
        pushLastBackupToSupabase().catch(e => log.error('?? backup distant crash:', e.message));
    }, { timezone: 'Europe/Paris' });
    log.info('?? Backup distant Supabase programm? (dimanche 05h Paris)');
}

module.exports = {
    runDailyBackup,
    scheduleDailyBackups,
    pushLastBackupToSupabase,
};
