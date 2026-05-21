// MODIFIE CHANTIER 6 - 14/05/2026 - upload images craft extrait de crafts.js

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const CRAFT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
    jpeg: {
        extensions: new Set(['.jpg', '.jpeg']),
        mimes: new Set(['image/jpeg']),
        matches: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    },
    png: {
        extensions: new Set(['.png']),
        mimes: new Set(['image/png']),
        matches: buffer => buffer.length >= 8
            && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
            && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a,
    },
    webp: {
        extensions: new Set(['.webp']),
        mimes: new Set(['image/webp']),
        matches: buffer => buffer.length >= 12
            && buffer.toString('ascii', 0, 4) === 'RIFF'
            && buffer.toString('ascii', 8, 12) === 'WEBP',
    },
    gif: {
        extensions: new Set(['.gif']),
        mimes: new Set(['image/gif']),
        matches: buffer => buffer.length >= 6
            && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a'),
    },
};

const ALLOWED_IMAGES = new Map(
    Object.values(IMAGE_TYPES).flatMap(type => [...type.extensions].map(ext => [ext, type.mimes]))
);

function detectImageType(buffer) {
    for (const [type, meta] of Object.entries(IMAGE_TYPES)) {
        if (meta.matches(buffer)) return type;
    }
    return null;
}

function validateImageFileSignature(file, readFile = fs.readFileSync) {
    const ext = path.extname(file.originalname || file.filename || '').toLowerCase();
    const mimetype = String(file.mimetype || '').toLowerCase();
    const allowedMimes = ALLOWED_IMAGES.get(ext);
    if (!allowedMimes) throw new Error('Format non supporte');
    if (!allowedMimes.has(mimetype)) throw new Error('Type MIME incoherent');
    if (Number(file.size || 0) > CRAFT_UPLOAD_MAX_BYTES) throw new Error('Fichier trop lourd');

    const buffer = Buffer.isBuffer(file.buffer)
        ? file.buffer
        : readFile(file.path).subarray(0, 32);
    const detectedType = detectImageType(buffer);
    if (!detectedType) throw new Error('Signature image invalide');

    const detected = IMAGE_TYPES[detectedType];
    if (!detected.extensions.has(ext) || !detected.mimes.has(mimetype)) {
        throw new Error('Signature image incoherente');
    }
    return detectedType;
}

function safeDeleteUploadedFile(uploadsDir, filenameOrPath) {
    if (!filenameOrPath) return false;
    const safeName = path.basename(String(filenameOrPath));
    const uploadRoot = path.resolve(uploadsDir);
    const target = path.resolve(uploadRoot, safeName);
    if (target !== path.join(uploadRoot, safeName)) return false;
    if (!target.startsWith(`${uploadRoot}${path.sep}`)) return false;
    if (!fs.existsSync(target)) return false;
    fs.unlinkSync(target);
    return true;
}

function flattenUploadedFiles(req) {
    if (req.file) return [req.file];
    if (Array.isArray(req.files)) return req.files;
    if (req.files && typeof req.files === 'object') return Object.values(req.files).flat();
    return [];
}

function deleteUploadedFiles(files) {
    for (const file of files) {
        if (file?.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    }
}

function validateUploadedImages(req, res, next) {
    const files = flattenUploadedFiles(req);
    try {
        for (const file of files) validateImageFileSignature(file);
        next();
    } catch (error) {
        deleteUploadedFiles(files);
        next(error);
    }
}

function createCraftUploadMiddleware(uploadsDir) {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadsDir),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, `weapon_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`);
        },
    });

    const upload = multer({
        storage,
        limits: { fileSize: CRAFT_UPLOAD_MAX_BYTES },
        fileFilter: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const allowedMimes = ALLOWED_IMAGES.get(ext);
            if (!allowedMimes) return cb(new Error('Format non supporte'));
            if (!allowedMimes.has(String(file.mimetype || '').toLowerCase())) {
                return cb(new Error('Type MIME incoherent'));
            }
            return cb(null, true);
        },
    });

    return {
        single: field => [upload.single(field), validateUploadedImages],
        fields: fields => [upload.fields(fields), validateUploadedImages],
        array: (field, maxCount) => [upload.array(field, maxCount), validateUploadedImages],
    };
}

module.exports = {
    CRAFT_UPLOAD_MAX_BYTES,
    createCraftUploadMiddleware,
    detectImageType,
    safeDeleteUploadedFile,
    validateUploadedImages,
    validateImageFileSignature,
};
