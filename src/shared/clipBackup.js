const config = require('./config');
const { ensureDataDirs } = require('./database');
const supabase = require('./supabase');

let Database;
let db;
let backfillRunning = false;
let lastBackfillSummary = null;

const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)(?:[?#].*)?$/i;
const CLIP_DOMAIN_RE = /(?:medal\.tv|streamable\.com|youtube\.com|youtu\.be|twitch\.tv|clips\.twitch\.tv|discord(?:app)?\.com\/channels|cdn\.discordapp\.com|media\.discordapp\.net)/i;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

function getDb() {
    if (db) return db;
    ensureDataDirs();
    Database = Database || require('better-sqlite3');
    db = new Database(config.paths.database);
    db.pragma('journal_mode = WAL');
    initClipBackupTables();
    return db;
}

function initClipBackupTables() {
    const database = db;
    database.exec(`
        CREATE TABLE IF NOT EXISTS clip_backups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            attachment_id TEXT,
            forum_id TEXT,
            thread_id TEXT,
            thread_name TEXT,
            author_id TEXT,
            author_name TEXT,
            content TEXT,
            original_url TEXT,
            storage_url TEXT,
            storage_path TEXT,
            source_type TEXT,
            file_name TEXT,
            file_size INTEGER,
            mime_type TEXT,
            tags_json TEXT,
            discord_message_url TEXT,
            status TEXT DEFAULT 'saved',
            error_message TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            backed_up_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS clip_backfill_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            forum_id TEXT,
            thread_id TEXT,
            last_message_id TEXT,
            status TEXT,
            scanned_messages INTEGER DEFAULT 0,
            found_clips INTEGER DEFAULT 0,
            uploaded_files INTEGER DEFAULT 0,
            error_message TEXT,
            started_at INTEGER,
            updated_at INTEGER,
            completed_at INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clip_backup_attachment
            ON clip_backups(message_id, attachment_id)
            WHERE attachment_id IS NOT NULL AND TRIM(attachment_id) != '';
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clip_backup_url
            ON clip_backups(message_id, original_url)
            WHERE original_url IS NOT NULL AND TRIM(original_url) != '';
        CREATE INDEX IF NOT EXISTS idx_clip_backup_thread ON clip_backups(thread_id);
        CREATE INDEX IF NOT EXISTS idx_clip_backfill_thread ON clip_backfill_state(thread_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clip_backfill_unique
            ON clip_backfill_state(forum_id, thread_id);
    `);
}

function updateBackfillState(thread, patch = {}) {
    const now = Math.floor(Date.now() / 1000);
    const existing = getDb().prepare('SELECT id FROM clip_backfill_state WHERE forum_id = ? AND thread_id = ?')
        .get(String(config.clips.forumChannelId), String(thread.id));
    if (!existing) {
        getDb().prepare(`
            INSERT INTO clip_backfill_state (
                forum_id, thread_id, last_message_id, status, scanned_messages, found_clips,
                uploaded_files, error_message, started_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            String(config.clips.forumChannelId),
            String(thread.id),
            patch.last_message_id || null,
            patch.status || 'scanning',
            patch.scanned_messages || 0,
            patch.found_clips || 0,
            patch.uploaded_files || 0,
            patch.error_message || null,
            now,
            now,
            patch.completed_at || null
        );
        return;
    }
    getDb().prepare(`
        UPDATE clip_backfill_state
        SET last_message_id = COALESCE(?, last_message_id),
            status = COALESCE(?, status),
            scanned_messages = COALESCE(?, scanned_messages),
            found_clips = COALESCE(?, found_clips),
            uploaded_files = COALESCE(?, uploaded_files),
            error_message = ?,
            updated_at = ?,
            completed_at = COALESCE(?, completed_at)
        WHERE id = ?
    `).run(
        patch.last_message_id || null,
        patch.status || null,
        typeof patch.scanned_messages === 'number' ? patch.scanned_messages : null,
        typeof patch.found_clips === 'number' ? patch.found_clips : null,
        typeof patch.uploaded_files === 'number' ? patch.uploaded_files : null,
        patch.error_message || null,
        now,
        patch.completed_at || null,
        existing.id
    );
}

function isForumClipMessage(message) {
    return Boolean(
        message?.channel?.isThread?.()
        && String(message.channel.parentId || '') === String(config.clips.forumChannelId || '')
    );
}

function extractClipLinks(content) {
    const urls = String(content || '').match(URL_RE) || [];
    return [...new Set(urls.map(url => url.replace(/[.,;:!?]+$/, '')))]
        .filter(url => VIDEO_EXT_RE.test(url) || CLIP_DOMAIN_RE.test(url));
}

function isClipAttachment(attachment) {
    const contentType = String(attachment?.contentType || attachment?.mimeType || '').toLowerCase();
    const name = String(attachment?.name || attachment?.filename || '').toLowerCase();
    return contentType.startsWith('video/') || VIDEO_EXT_RE.test(name);
}

function getThreadTags(thread) {
    const tagIds = Array.isArray(thread?.appliedTags) ? thread.appliedTags : [];
    const parentTags = thread?.parent?.availableTags || thread?.parent?.available_tags || [];
    const names = tagIds.map(id => {
        const tag = parentTags.find(t => String(t.id) === String(id));
        return tag ? { id: String(id), name: tag.name } : { id: String(id), name: String(id) };
    });
    return JSON.stringify(names);
}

function discordMessageUrl(message) {
    const guildId = message.guildId || message.guild?.id || '@me';
    return `https://discord.com/channels/${guildId}/${message.channelId}/${message.id}`;
}

function clipStoragePath(message, fileName) {
    const date = message.createdAt || new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const safeName = String(fileName || 'clip.mp4')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'clip.mp4';
    return `clips/${year}/${month}/${message.channelId}/${message.id}/${safeName}`;
}

function saveClipBackupRecord(record) {
    const database = getDb();
    const existing = record.attachment_id
        ? database.prepare('SELECT * FROM clip_backups WHERE message_id = ? AND attachment_id = ?').get(record.message_id, record.attachment_id)
        : database.prepare('SELECT * FROM clip_backups WHERE message_id = ? AND original_url = ?').get(record.message_id, record.original_url);
    if (existing) return { row: existing, inserted: false };

    const now = Math.floor(Date.now() / 1000);
    const result = database.prepare(`
        INSERT INTO clip_backups (
            message_id, attachment_id, forum_id, thread_id, thread_name, author_id, author_name,
            content, original_url, storage_url, storage_path, source_type, file_name, file_size,
            mime_type, tags_json, discord_message_url, status, error_message, backed_up_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        record.message_id, record.attachment_id || null, record.forum_id, record.thread_id, record.thread_name,
        record.author_id, record.author_name, record.content || null, record.original_url || null,
        record.storage_url || null, record.storage_path || null, record.source_type, record.file_name || null,
        record.file_size || null, record.mime_type || null, record.tags_json || null, record.discord_message_url,
        record.status || 'saved', record.error_message || null, now
    );
    return { row: { id: result.lastInsertRowid, ...record }, inserted: true };
}

function markClipBackupUploaded(id, uploaded) {
    getDb().prepare('UPDATE clip_backups SET storage_url = ?, storage_path = ?, status = ?, error_message = NULL, backed_up_at = ? WHERE id = ?')
        .run(uploaded.publicUrl, uploaded.path, 'uploaded', Math.floor(Date.now() / 1000), id);
}

function markClipBackupFailed(id, error) {
    getDb().prepare('UPDATE clip_backups SET status = ?, error_message = ?, backed_up_at = ? WHERE id = ?')
        .run('failed', String(error?.message || error || 'Erreur upload'), Math.floor(Date.now() / 1000), id);
}

async function uploadAttachmentToSupabase(message, attachment, rowId, options = {}) {
    if (!supabase.isSupabaseConfigured()) {
        throw new Error('Supabase clips non configure');
    }
    if (Number(attachment.size || 0) > config.clips.maxFileSizeBytes) {
        throw new Error('Clip trop volumineux pour la sauvegarde Supabase');
    }

    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`Telechargement Discord echoue (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const objectPath = clipStoragePath(message, attachment.name || attachment.filename);
    const uploaded = await supabase.uploadFile(config.clips.bucket, objectPath, buffer, {
        contentType: attachment.contentType || 'application/octet-stream',
        upsert: !!options.upsert,
    });
    markClipBackupUploaded(rowId, uploaded);
    return uploaded;
}

async function retryFailedClipBackupRow(client, row) {
    const channel = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!channel?.messages) throw new Error(`Thread clips introuvable (${row.thread_id})`);
    const message = await channel.messages.fetch(row.message_id).catch(() => null);
    if (!message) throw new Error(`Message clip introuvable (${row.message_id})`);
    const attachment = [...message.attachments.values()].find(item =>
        String(item.id || '') === String(row.attachment_id || '')
    );
    if (!attachment) throw new Error(`Attachment clip introuvable (${row.attachment_id})`);
    await uploadAttachmentToSupabase(message, attachment, row.id, { upsert: true });
    return true;
}

async function retryFailedClipBackups(client, limit = 25) {
    const rows = getDb().prepare(`
        SELECT * FROM clip_backups
        WHERE status = 'failed'
          AND source_type = 'discord_attachment'
          AND (storage_url IS NULL OR TRIM(storage_url) = '')
        ORDER BY backed_up_at ASC, id ASC
        LIMIT ?
    `).all(Math.max(1, Math.min(100, Number(limit) || 25)));
    const summary = { scanned: rows.length, retried: 0, uploaded: 0, errors: 0 };
    for (const row of rows) {
        summary.retried++;
        try {
            await retryFailedClipBackupRow(client, row);
            summary.uploaded++;
        } catch (e) {
            summary.errors++;
            markClipBackupFailed(row.id, e);
            console.error(`[clips] retry failed id=${row.id}: ${e.message}`);
        }
    }
    return summary;
}

async function processClipMessage(message) {
    if (!message || message.author?.bot || !isForumClipMessage(message)) return { ignored: true };

    const thread = message.channel;
    const base = {
        message_id: String(message.id),
        forum_id: String(config.clips.forumChannelId),
        thread_id: String(thread.id),
        thread_name: thread.name || '',
        author_id: String(message.author?.id || ''),
        author_name: message.author?.username || message.author?.tag || '',
        content: message.content || '',
        tags_json: getThreadTags(thread),
        discord_message_url: discordMessageUrl(message),
    };

    let found = 0;
    let uploaded = 0;
    let duplicates = 0;
    let errors = 0;

    for (const url of extractClipLinks(message.content)) {
        const result = saveClipBackupRecord({
            ...base,
            original_url: url,
            source_type: 'external_link',
            status: 'saved',
        });
        found++;
        if (!result.inserted) duplicates++;
    }

    for (const attachment of message.attachments?.values?.() || []) {
        if (!isClipAttachment(attachment)) continue;
        const result = saveClipBackupRecord({
            ...base,
            attachment_id: String(attachment.id || ''),
            original_url: attachment.url,
            source_type: 'discord_attachment',
            file_name: attachment.name || attachment.filename || null,
            file_size: attachment.size || null,
            mime_type: attachment.contentType || null,
            status: 'pending_upload',
        });
        found++;
        if (!result.inserted) {
            duplicates++;
            if (
                result.row?.status === 'failed'
                && result.row?.source_type === 'discord_attachment'
                && !String(result.row?.storage_url || '').trim()
            ) {
                try {
                    await uploadAttachmentToSupabase(message, attachment, result.row.id, { upsert: true });
                    uploaded++;
                } catch (e) {
                    errors++;
                    markClipBackupFailed(result.row.id, e);
                    console.error(`[clips] retry upload echoue message=${message.id}: ${e.message}`);
                }
            }
            continue;
        }
        try {
            await uploadAttachmentToSupabase(message, attachment, result.row.id);
            uploaded++;
        } catch (e) {
            errors++;
            markClipBackupFailed(result.row.id, e);
            console.error(`[clips] upload echoue message=${message.id}: ${e.message}`);
        }
    }

    if (found) {
        console.log(`[clips] message=${message.id} found=${found} uploaded=${uploaded} duplicates=${duplicates} errors=${errors}`);
    }
    return { found, uploaded, duplicates, errors };
}

async function fetchThreadMessages(thread, summary) {
    let before;
    let scanned = 0;
    const batchSize = Math.max(1, Math.min(100, config.clips.backfillBatchSize || 50));
    updateBackfillState(thread, { status: 'scanning' });
    while (true) {
        const messages = await thread.messages.fetch({ limit: batchSize, before }).catch(e => {
            summary.errors++;
            console.error(`[clips] backfill messages echoue thread=${thread.id}: ${e.message}`);
            updateBackfillState(thread, { status: 'error', error_message: e.message });
            return null;
        });
        if (!messages?.size) break;
        const ordered = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        for (const message of ordered) {
            const result = await processClipMessage(message);
            scanned++;
            summary.messagesScanned++;
            summary.linksFound += result?.found || 0;
            summary.filesUploaded += result?.uploaded || 0;
            summary.duplicatesIgnored += result?.duplicates || 0;
        }
        before = messages.last()?.id;
        updateBackfillState(thread, {
            last_message_id: before,
            status: 'scanning',
            scanned_messages: scanned,
            found_clips: summary.linksFound,
            uploaded_files: summary.filesUploaded,
        });
        if (messages.size < batchSize) break;
        await new Promise(resolve => setTimeout(resolve, 750));
    }
    updateBackfillState(thread, {
        status: 'completed',
        scanned_messages: scanned,
        found_clips: summary.linksFound,
        uploaded_files: summary.filesUploaded,
        completed_at: Math.floor(Date.now() / 1000),
    });
    return scanned;
}

async function listForumThreads(forum) {
    const threads = new Map();
    const active = await forum.threads.fetchActive().catch(() => null);
    for (const thread of active?.threads?.values?.() || []) threads.set(thread.id, thread);

    let before;
    for (let page = 0; page < 20; page++) {
        const archived = await forum.threads.fetchArchived({ limit: 100, before }).catch(() => null);
        for (const thread of archived?.threads?.values?.() || []) threads.set(thread.id, thread);
        if (!archived?.threads?.size || !archived?.hasMore) break;
        before = archived.threads.last()?.archiveTimestamp;
        await new Promise(resolve => setTimeout(resolve, 750));
    }
    return [...threads.values()];
}

async function backfillClipForum(client) {
    if (backfillRunning) return { running: true, ...lastBackfillSummary };
    backfillRunning = true;
    const started = Date.now();
    const summary = {
        running: true,
        threadsScanned: 0,
        messagesScanned: 0,
        linksFound: 0,
        filesUploaded: 0,
        duplicatesIgnored: 0,
        errors: 0,
        startedAt: new Date(started).toISOString(),
    };
    lastBackfillSummary = summary;

    try {
        const forum = await client.channels.fetch(config.clips.forumChannelId);
        if (!forum?.threads) throw new Error('Forum clips introuvable ou inaccessible');
        const threads = await listForumThreads(forum);
        for (const thread of threads) {
            summary.threadsScanned++;
            await fetchThreadMessages(thread, summary);
            lastBackfillSummary = { ...summary };
        }
        summary.completedAt = new Date().toISOString();
        summary.durationMs = Date.now() - started;
        summary.running = false;
        console.log(`[clips] backfill termine threads=${summary.threadsScanned} messages=${summary.messagesScanned}`);
        return summary;
    } catch (e) {
        summary.errors++;
        summary.error = e.message;
        summary.running = false;
        console.error(`[clips] backfill echoue: ${e.message}`);
        return summary;
    } finally {
        backfillRunning = false;
        lastBackfillSummary = { ...summary };
    }
}

function getBackfillStatus() {
    return lastBackfillSummary || { running: false };
}

function getRecentClipBackups(limit = 50) {
    return getDb().prepare('SELECT * FROM clip_backups ORDER BY created_at DESC, id DESC LIMIT ?').all(Math.max(1, Math.min(200, Number(limit) || 50)));
}

module.exports = {
    processClipMessage,
    backfillClipForum,
    getBackfillStatus,
    getRecentClipBackups,
    retryFailedClipBackups,
    extractClipLinks,
    isClipAttachment,
};
