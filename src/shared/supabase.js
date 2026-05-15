// FINAL D4 16/05/2026 — listage et suppression distants Supabase
const config = require('./config');

function assertSupabaseConfigured() {
    if (!config.supabase.url || !config.supabase.key) {
        throw new Error('Supabase Storage is not configured');
    }
}

function isSupabaseConfigured() {
    return Boolean(config.supabase.url && config.supabase.key);
}

function validateFile(file, options = {}) {
    if (!file) return { ok: false, error: 'Fichier manquant' };
    const maxFileSizeBytes = options.maxFileSizeBytes || config.uploads.maxFileSizeBytes;
    const allowedMimeTypes = options.allowedMimeTypes || config.uploads.allowedMimeTypes;
    const size = file.size || file.length || file.byteLength || 0;
    const mimeType = file.mimetype || file.type || '';

    if (size > maxFileSizeBytes) return { ok: false, error: 'Fichier trop volumineux' };
    if (mimeType && allowedMimeTypes.length && !allowedMimeTypes.includes(mimeType)) {
        return { ok: false, error: 'Type de fichier non autorise' };
    }
    return { ok: true };
}

function getObjectUrl(bucket, objectPath) {
    const base = config.supabase.url.replace(/\/$/, '');
    return `${base}/storage/v1/object/${bucket}/${objectPath.replace(/^\/+/, '')}`;
}

async function uploadFile(bucket, objectPath, buffer, options = {}) {
    assertSupabaseConfigured();
    const targetBucket = bucket || config.supabase.bucket;
    const response = await fetch(getObjectUrl(targetBucket, objectPath), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.supabase.key}`,
            apikey: config.supabase.key,
            'Content-Type': options.contentType || 'application/octet-stream',
            'x-upsert': options.upsert ? 'true' : 'false'
        },
        body: buffer
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Supabase upload failed (${response.status}): ${text}`);
    }

    return {
        bucket: targetBucket,
        path: objectPath,
        publicUrl: getPublicUrl(targetBucket, objectPath)
    };
}

async function deleteFile(bucket, objectPath) {
    assertSupabaseConfigured();
    const targetBucket = bucket || config.supabase.bucket;
    const base = config.supabase.url.replace(/\/$/, '');
    const response = await fetch(`${base}/storage/v1/object/${targetBucket}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${config.supabase.key}`,
            apikey: config.supabase.key,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefixes: [objectPath] })
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Supabase delete failed (${response.status}): ${text}`);
    }
    return true;
}

async function listFiles(bucket, prefix = '') {
    assertSupabaseConfigured();
    const targetBucket = bucket || config.supabase.bucket;
    const base = config.supabase.url.replace(/\/$/, '');
    const normalizedPrefix = String(prefix || '').replace(/^\/+/, '');
    const response = await fetch(`${base}/storage/v1/object/list/${targetBucket}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.supabase.key}`,
            apikey: config.supabase.key,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            prefix: normalizedPrefix,
            limit: 100,
            offset: 0,
            sortBy: { column: 'created_at', order: 'desc' }
        })
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Supabase list failed (${response.status}): ${text}`);
    }

    return response.json();
}

function getPublicUrl(bucket, objectPath) {
    const targetBucket = bucket || config.supabase.bucket;
    const base = config.supabase.url.replace(/\/$/, '');
    return `${base}/storage/v1/object/public/${targetBucket}/${objectPath.replace(/^\/+/, '')}`;
}

module.exports = {
    isSupabaseConfigured,
    uploadFile,
    listFiles,
    deleteFile,
    getPublicUrl,
    validateFile
};
