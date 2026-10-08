/* Large portable archives for played Worlds and full-install backups.
 * JSON is sharded into bounded files; repeated data URLs live once in ZIP.
 * The existing ZIP reader verifies every entry's CRC before restore begins. */
(function (root) {
'use strict';

const PART_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 128;
const MAX_FILES = 9000;
const MAX_ARRAY_ITEMS = 500000;
const FORMAT = 'horde-large-archive';
const KINDS = new Set(['world-campaign', 'full-backup']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const DATA_URL = /^data:[a-z0-9.+/-]+(?:;[a-z0-9=.+-]+)*;base64,/i;
const VH2_CHECKPOINT_MIME = 'application/vnd.horde.vh2-transfer+zip';
const VH2_CHECKPOINT_BYTES = 2 * 1024 * 1024 * 1024;
const encoder = new TextEncoder();

function jsonSize(value) { return encoder.encode(JSON.stringify(value)).length; }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Blob); }
function assertDepth(depth) { if (depth > MAX_DEPTH) throw Error('Archive nesting is too deep.'); }

async function pack(value, kind, onProgress = () => {}) {
    if (!KINDS.has(kind)) throw Error('Unsupported archive kind.');
    const marker = '$hordeArchive:' + crypto.randomUUID();
    const entries = [];
    const media = new Map();
    const ancestors = new Set();
    let nextId = 0;
    const reference = (type, fields) => ({ [marker]: { type, ...fields } });
    function add(prefix, suffix, blob) {
        if (entries.length >= MAX_FILES) throw Error('Archive has too many files. Export a smaller campaign.');
        const path = `${prefix}/${String(++nextId).padStart(6, '0')}.${suffix}`;
        entries.push([path, blob]);
        return path;
    }
    function writeJson(value) {
        const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
        if (blob.size > PART_BYTES) throw Error('An archive metadata chunk is too large.');
        return add('data', 'json', blob);
    }
    async function encode(item, depth = 0) {
        assertDepth(depth);
        if (item === null || typeof item === 'boolean' || typeof item === 'number') return item;
        if (typeof item === 'string') {
            const size = new Blob([item]).size;
            if (size > 65536 && DATA_URL.test(item)) {
                if ((item.length - item.indexOf(',') - 1) * 3 / 4 > 1024 * 1024 * 1024 + 3) {
                    throw Error('One encoded media item exceeds the supported 1 GB archive asset limit.');
                }
                let path = media.get(item);
                if (!path) {
                    const blob = await root.HordeHumanPackage.dataBlob(item);
                    if (blob.size > 1024 * 1024 * 1024) throw Error('One media item exceeds the supported 1 GB archive asset limit.');
                    path = add('media', 'bin', blob);
                    media.set(item, path);
                    onProgress(`Collected ${media.size} media asset${media.size === 1 ? '' : 's'}`);
                }
                return reference('data-url', { path, prefix: item.slice(0, item.indexOf(',') + 1) });
            }
            if (size > 512 * 1024 * 1024) throw Error('One text field exceeds the supported 512 MB archive limit.');
            if (size > PART_BYTES / 2) return reference('text', {
                path: add('text', 'txt', new Blob([item], { type: 'text/plain' }))
            });
            return item;
        }
        if (item instanceof Blob) {
            const limit = kind === 'full-backup' && item.type === VH2_CHECKPOINT_MIME
                ? VH2_CHECKPOINT_BYTES : 1024 * 1024 * 1024;
            if (item.size > limit) throw Error('One media file exceeds the supported archive limit.');
            return reference('blob', {
            path: add('media', 'bin', item), mime: item.type || 'application/octet-stream'
            });
        }
        if (typeof item !== 'object') return null;
        if (ancestors.has(item)) throw Error('Circular archive data cannot be exported.');
        ancestors.add(item);
        try {
            if (typeof item.toJSON === 'function') return encode(item.toJSON(), depth + 1);
            if (Array.isArray(item)) {
                if (item.length > MAX_ARRAY_ITEMS) throw Error('An archive list exceeds 500,000 entries.');
                let part = [], size = 2;
                const paths = [];
                for (const child of item) {
                    const encoded = await encode(child, depth + 1);
                    const bytes = jsonSize(encoded) + (part.length ? 1 : 0);
                    if (part.length && size + bytes > PART_BYTES) {
                        paths.push(writeJson(part)); part = []; size = 2;
                    }
                    part.push(encoded); size += bytes;
                    if (size > PART_BYTES) throw Error('An archive item is too large.');
                }
                if (!paths.length) return part;
                if (part.length) paths.push(writeJson(part));
                return reference('array', { paths, length: item.length });
            }
            let part = {}, size = 2, count = 0;
            const paths = [];
            for (const [key, child] of Object.entries(item)) {
                if (UNSAFE_KEYS.has(key) || child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
                const encoded = await encode(child, depth + 1);
                const bytes = jsonSize(key) + 1 + jsonSize(encoded) + (count ? 1 : 0);
                if (count && size + bytes > PART_BYTES) {
                    paths.push(writeJson(part)); part = {}; size = 2; count = 0;
                }
                Object.defineProperty(part, key, { value: encoded, enumerable: true, configurable: true, writable: true });
                size += bytes; count++;
                if (size > PART_BYTES) throw Error('An archive item is too large.');
            }
            if (!paths.length) return part;
            if (count) paths.push(writeJson(part));
            return reference('object', { paths });
        } finally { ancestors.delete(item); }
    }

    const encoded = await encode(value);
    const manifest = new Blob([JSON.stringify({ format: FORMAT, version: 1, kind, marker, value: encoded })], { type: 'application/json' });
    if (manifest.size > PART_BYTES) throw Error('Archive manifest is too large.');
    entries.unshift(['archive.json', manifest]);
    return root.HordeHumanPackage.zip(entries, (done, total) => onProgress(`Checking ${done} of ${total} archive files`));
}

async function unpack(file, expectedKind) {
    const files = await root.HordeHumanPackage.unzip(file);
    const manifestFile = files.get('archive.json');
    if (!manifestFile || manifestFile.size > PART_BYTES) throw Error('Missing or oversized archive manifest.');
    const manifest = JSON.parse(await manifestFile.text());
    if (manifest.format !== FORMAT || manifest.version !== 1 || !KINDS.has(manifest.kind)
        || expectedKind && manifest.kind !== expectedKind
        || typeof manifest.marker !== 'string' || !/^\$hordeArchive:[a-f0-9-]{36}$/.test(manifest.marker)) {
        throw Error('Unsupported or incorrect archive package.');
    }
    const marker = manifest.marker;
    const used = new Set(['archive.json']);
    const jsonPaths = new Set();
    const mediaCache = new Map();
    function fileAt(path, prefix, maxSize) {
        if (typeof path !== 'string' || !path.startsWith(prefix + '/') || !files.has(path)) {
            throw Error('Archive is missing a required file.');
        }
        const blob = files.get(path);
        if (blob.size > maxSize) throw Error('Archive file exceeds its safety limit.');
        used.add(path);
        return blob;
    }
    async function readJson(path) {
        if (jsonPaths.has(path)) throw Error('Archive contains a repeated metadata reference.');
        jsonPaths.add(path);
        return JSON.parse(await fileAt(path, 'data', PART_BYTES).text());
    }
    async function decode(item, depth = 0) {
        assertDepth(depth);
        if (!item || typeof item !== 'object') return item;
        if (Array.isArray(item)) {
            const values = [];
            for (const child of item) values.push(await decode(child, depth + 1));
            return values;
        }
        if (Object.hasOwn(item, marker)) {
            if (Object.keys(item).length !== 1 || !plain(item[marker])) throw Error('Invalid archive reference.');
            const ref = item[marker];
            if (ref.type === 'array' || ref.type === 'object') {
                if (!Array.isArray(ref.paths) || !ref.paths.length || ref.paths.length > MAX_FILES
                    || ref.type === 'array' && (!Number.isSafeInteger(ref.length) || ref.length > MAX_ARRAY_ITEMS)) {
                    throw Error('Invalid archive chunks.');
                }
                const result = ref.type === 'array' ? [] : {};
                for (const path of ref.paths) {
                    const part = await readJson(path);
                    if (ref.type === 'array') {
                        if (!Array.isArray(part)) throw Error('Invalid archive array chunk.');
                        for (const child of part) result.push(await decode(child, depth + 1));
                    } else {
                        if (!plain(part)) throw Error('Invalid archive object chunk.');
                        for (const [key, child] of Object.entries(part)) {
                            if (UNSAFE_KEYS.has(key) || Object.hasOwn(result, key)) throw Error('Unsafe or repeated archive field.');
                            Object.defineProperty(result, key, { value: await decode(child, depth + 1), enumerable: true, configurable: true, writable: true });
                        }
                    }
                }
                if (ref.type === 'array' && (!Number.isSafeInteger(ref.length) || result.length !== ref.length)) {
                    throw Error('Incomplete archive array.');
                }
                return result;
            }
            if (ref.type === 'text') return fileAt(ref.path, 'text', 512 * 1024 * 1024).text();
            if (ref.type === 'blob') {
                if (typeof ref.mime !== 'string' || !/^[a-z0-9.+/-]{1,100}$/i.test(ref.mime)) throw Error('Invalid archive media type.');
                const limit = manifest.kind === 'full-backup' && ref.mime === VH2_CHECKPOINT_MIME
                    ? VH2_CHECKPOINT_BYTES : 1024 * 1024 * 1024;
                return fileAt(ref.path, 'media', limit).slice(0, undefined, ref.mime);
            }
            if (ref.type === 'data-url') {
                if (typeof ref.prefix !== 'string' || ref.prefix.length > 200 || !DATA_URL.test(ref.prefix)
                    || !ref.prefix.endsWith(',')) throw Error('Invalid archive media reference.');
                const blob = fileAt(ref.path, 'media', 1024 * 1024 * 1024);
                const cacheKey = ref.path + '|' + ref.prefix;
                if (!mediaCache.has(cacheKey)) {
                    const mime = ref.prefix.slice(5, ref.prefix.indexOf(';'));
                    const source = await root.HordeHumanPackage.dataUrl(blob.slice(0, undefined, mime));
                    mediaCache.set(cacheKey, ref.prefix + source.slice(source.indexOf(',') + 1));
                }
                return mediaCache.get(cacheKey);
            }
            throw Error('Unknown archive reference.');
        }
        const result = {};
        for (const [key, child] of Object.entries(item)) {
            if (UNSAFE_KEYS.has(key)) throw Error('Unsafe archive field.');
            Object.defineProperty(result, key, { value: await decode(child, depth + 1), enumerable: true, configurable: true, writable: true });
        }
        return result;
    }
    const result = await decode(manifest.value);
    if (used.size !== files.size) throw Error('Archive contains unexpected files.');
    return result;
}

root.HordeLargeArchive = { pack, unpack, FORMAT, PART_BYTES };
if (typeof module !== 'undefined') module.exports = root.HordeLargeArchive;
})(globalThis);
