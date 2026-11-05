import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, unlink, readdir } from 'node:fs/promises';
import { storageRoot } from './storage';
import { verifyToken } from './security';
export function multipartUploads() {
    let active = false;
    return async (req: Request, res: Response, next: NextFunction) => {
        if (req.method !== 'POST' || !['/api/admin/uploads/preview', '/api/admin/imports'].includes(req.path))
            return next();
        try {
            verifyToken(req.headers.authorization?.replace(/^Bearer /, '') || '', 'admin');
        }
        catch {
            return res.status(401).json({ statusCode: 401, message: 'Admin token required' });
        }
        if (active)
            return res.status(409).json({ statusCode: 409, message: 'Another upload is active; retry' });
        if (Number(req.headers['content-length'] || 0) > 120 * 1024 * 1024)
            return res.status(413).json({ statusCode: 413, message: 'Multipart request exceeds 120 MiB' });
        active = true;
        const paths: string[] = [];
        let cleaned = false;
        const cleanup = () => { if (cleaned)
            return; cleaned = true; active = false; for (const path of paths)
            void unlink(path).catch(() => { setTimeout(() => void unlink(path).catch(() => undefined), 100).unref(); }); };
        res.once('finish', cleanup);
        res.once('close', cleanup);
        req.once('aborted', cleanup);
        const incoming = join(storageRoot(), 'private', 'incoming');
        try {
            await mkdir(incoming, { recursive: true, mode: 0o700 });
        }
        catch {
            return res.status(503).json({ statusCode: 503, message: 'Private staging directory unavailable' });
        }
        const disk = multer.diskStorage({ destination: incoming, filename: (_r, _f, cb) => { const name = `${randomUUID()}.upload`; paths.push(join(incoming, name)); cb(null, name); } });
        const upload = multer({ storage: disk, limits: { fileSize: 80 * 1024 * 1024, files: 21, fields: 2, fieldSize: 256 * 1024, parts: 23 } });
        let received = 0;
        req.on('data', (chunk: Buffer) => { received += chunk.length; if (received > 120 * 1024 * 1024) {
            if (!res.headersSent)
                res.status(413).json({ statusCode: 413, message: 'Multipart request exceeds 120 MiB' });
            req.destroy();
        } });
        const handler = req.path.endsWith('/preview') ? upload.single('file') : upload.fields([{ name: 'source', maxCount: 1 }, { name: 'previews', maxCount: 20 }]);
        handler(req, res, (error: any) => { if (error) {
            if (!res.headersSent)
                res.status(400).json({ statusCode: 400, message: 'Invalid multipart upload or upload limit exceeded' });
            return;
        } if (!res.headersSent)
            next(); });
    };
}
export async function prepareIncoming() { const root = join(storageRoot(), 'private', 'incoming'); await mkdir(root, { recursive: true, mode: 0o700 }); for (const name of await readdir(root)) {
    if (/^[0-9a-f-]{36}\.upload$/.test(name))
        await unlink(join(root, name)).catch(() => undefined);
} }
