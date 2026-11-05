import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual, scryptSync } from 'node:crypto';
import { z } from 'zod';
export const provider = z.enum(['baidu', 'quark']);
export function driveUrl(value: string, expected?: string) {
    let u: URL;
    try {
        u = new URL(value);
    }
    catch {
        throw new BadRequestException('Invalid drive URL');
    }
    const p = u.hostname === 'pan.baidu.com' ? 'baidu' : u.hostname === 'pan.quark.cn' ? 'quark' : undefined;
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !p || (expected && p !== expected) || !/^\/s\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))
        throw new BadRequestException('Only HTTPS Baidu/Quark share URLs are supported');
    return value;
}
export const publicUrl = z.string().max(1000).refine(v => /^\/assets\/[a-zA-Z0-9_./-]+$/.test(v) && !v.includes('..') || /^https:\/\//.test(v), 'Expected public preview URL');
export const resourceInput = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,179}$/), title: z.string().min(1).max(200), summary: z.string().max(3000).default(''), categoryId: z.string().min(1).max(36), topicIds: z.array(z.string().max(36)).max(30).default([]), tags: z.array(z.string().max(60)).max(30).default([]), ageMin: z.number().int().min(0).max(18), ageMax: z.number().int().min(0).max(18), difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']), pageCount: z.number().int().min(1).max(2000), paperSize: z.literal('A4'), colorMode: z.enum(['BW', 'COLOR']), hasAnswers: z.boolean(), materials: z.array(z.string().max(200)).max(30).default([]), instructions: z.string().min(1).max(10000), coverUrl: publicUrl, previewUrls: z.array(publicUrl).max(30), accessMode: z.enum(['FREE', 'REWARDED']).default('FREE'), status: z.enum(['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'), sources: z.array(z.object({ title: z.string().min(1).max(300), author: z.string().min(1).max(200), url: z.string().url().max(1000), license: z.string().min(1).max(2000), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() })).max(50) }).strict();
export function publication(data: any, links: any[]) {
    resourceInput.parse(data);
    if (data.ageMin > data.ageMax || !data.sources.length || !data.previewUrls.length || !data.coverUrl || !links.some(l => l.enabled))
        throw new BadRequestException('Publication requires attribution, valid print metadata, preview and enabled drive link');
    for (const l of links.filter(l => l.enabled))
        driveUrl(l.url, l.provider);
}
function secret(kind: 'admin' | 'user') { const s = process.env[kind === 'admin' ? 'ADMIN_JWT_SECRET' : 'USER_JWT_SECRET']; if (!s || s.length < 32 || process.env.ADMIN_JWT_SECRET === process.env.USER_JWT_SECRET)
    throw new Error('Configure distinct JWT secrets of at least 32 characters'); return s; }
export function signToken(sub: string, kind: 'admin' | 'user') { const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'); const p = Buffer.from(JSON.stringify({ sub, kind, exp: Math.floor(Date.now() / 1000) + (kind === 'admin' ? 28800 : 604800) })).toString('base64url'); return `${h}.${p}.${createHmac('sha256', secret(kind)).update(`${h}.${p}`).digest('base64url')}`; }
export function verifyToken(token: string, kind: 'admin' | 'user') { try {
    const [h, p, s, ...extra] = token.split('.');
    if (extra.length || !h || !p || !s)
        throw 0;
    const expected = createHmac('sha256', secret(kind)).update(`${h}.${p}`).digest();
    const actual = Buffer.from(s, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
        throw 0;
    const data = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (data.kind !== kind || typeof data.sub !== 'string' || typeof data.exp !== 'number' || data.exp <= Date.now() / 1000)
        throw 0;
    return data.sub as string;
}
catch {
    throw new UnauthorizedException('Invalid or expired token');
} }
export function passwordMatches(password: string) { const hash = process.env.ADMIN_PASSWORD_HASH; if (hash) {
    const [type, salt, hex] = hash.split('$');
    if (type !== 'scrypt' || !salt || !hex)
        return false;
    const expected = Buffer.from(hex, 'hex');
    const actual = scryptSync(password, salt, 64);
    return expected.length === 64 && timingSafeEqual(actual, expected);
} const expected = process.env.ADMIN_PASSWORD; if (!expected || expected.length < 12)
    return false; const a = Buffer.from(password), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); }
export const requestId = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
export function allSucceeded(cp: any) { return cp?.baidu?.status === 'SUCCEEDED' && cp?.quark?.status === 'SUCCEEDED'; }
