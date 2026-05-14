// MODIFIÉ CHANTIER 11 — 14/05/2026 — backups automatiques Railway /data

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('../../shared/config');
const { createConnection } = require('../../shared/database');

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
        console.warn(`[backup] DB absente, backup SQLite ignoré: ${config.paths.database}`);
        return null;
    }

    const target = path.join(config.paths.backups, `crafts-${stamp}.db`);
    const db = createConnection(config.paths.database);
    try {
        await db.backup(target);
        console.log(`[backup] SQLite sauvegardé: ${target}`);
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
        console.log(`[backup] JSON sauvegardé: ${target}`);
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
        console.log(`[backup] Ancien backup supprimé: ${filePath}`);
    }
    return deleted;
}

async function runDailyBackup() {
    if (backupRunning) {
        console.warn('[backup] Backup déjà en cours, exécution ignorée');
        return;
    }

    backupRunning = true;
    try {
        fs.mkdirSync(config.paths.backups, { recursive: true });
        const stamp = formatDateStamp();
        const dbBackup = await backupCraftDatabase(stamp);
        const jsonBackups = backupRuntimeJson(stamp);
        const deleted = cleanupOldBackups();
        console.log(`[backup] Terminé — db=${dbBackup ? 1 : 0}, json=${jsonBackups.length}, purge=${deleted}`);
    } catch (e) {
        console.error('[backup] Échec backup automatique:', e.message);
    } finally {
        backupRunning = false;
    }
}

function scheduleDailyBackups() {
    cron.schedule('0 4 * * *', runDailyBackup, { timezone: 'Europe/Paris' });
    console.log('[backup] Cron daily 04h00 Europe/Paris programmé');
}

module.exports = {
    runDailyBackup,
    scheduleDailyBackups,
};
