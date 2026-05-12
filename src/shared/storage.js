const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const supabaseStorage = require('./supabase');

function validateFile(file, options = {}) {
    return supabaseStorage.validateFile(file, options);
}

function safeName(name) {
    return String(name || 'upload')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 140) || 'upload';
}

async function uploadLocalFile(file, options = {}) {
    const validation = validateFile(file, options);
    if (!validation.ok) throw new Error(validation.error);

    const folder = options.folder || 'uploads';
    const fileName = `${Date.now()}-${safeName(file.originalname || file.name)}`;
    const relativePath = path.join(folder, fileName);
    const absolutePath = path.join(config.paths.uploads, relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const buffer = file.buffer || file;
    await fs.writeFile(absolutePath, buffer);

    return {
        provider: 'local',
        path: relativePath.replace(/\\/g, '/'),
        publicUrl: `/uploads/${relativePath.replace(/\\/g, '/')}`
    };
}

async function uploadFile(file, options = {}) {
    const provider = options.provider || 'local';
    if (provider === 'supabase') {
        const validation = validateFile(file, options);
        if (!validation.ok) throw new Error(validation.error);
        const objectPath = options.path || `${options.folder || 'uploads'}/${Date.now()}-${safeName(file.originalname || file.name)}`;
        const buffer = file.buffer || file;
        const uploaded = await supabaseStorage.uploadFile(options.bucket || config.supabase.bucket, objectPath, buffer, {
            contentType: file.mimetype || file.type,
            upsert: options.upsert
        });
        return { provider: 'supabase', ...uploaded };
    }
    return uploadLocalFile(file, options);
}

async function deleteFile(fileRef, options = {}) {
    if (!fileRef) return false;
    const provider = options.provider || fileRef.provider || 'local';
    if (provider === 'supabase') {
        return supabaseStorage.deleteFile(options.bucket || fileRef.bucket || config.supabase.bucket, fileRef.path || fileRef);
    }

    const relativePath = typeof fileRef === 'string' ? fileRef : fileRef.path;
    if (!relativePath) return false;
    const absolutePath = path.join(config.paths.uploads, relativePath);
    await fs.rm(absolutePath, { force: true });
    return true;
}

function getPublicUrl(fileRef, options = {}) {
    if (!fileRef) return '';
    const provider = options.provider || fileRef.provider || 'local';
    if (provider === 'supabase') {
        return supabaseStorage.getPublicUrl(options.bucket || fileRef.bucket || config.supabase.bucket, fileRef.path || fileRef);
    }
    if (typeof fileRef === 'string' && fileRef.startsWith('/')) return fileRef;
    const relativePath = typeof fileRef === 'string' ? fileRef : fileRef.path;
    return relativePath ? `/uploads/${relativePath.replace(/\\/g, '/')}` : '';
}

module.exports = {
    uploadFile,
    deleteFile,
    getPublicUrl,
    validateFile
};
