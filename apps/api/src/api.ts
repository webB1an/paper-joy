import { All, Controller, Inject, Req, Res, BadRequestException, UnauthorizedException, ForbiddenException, NotFoundException, ConflictException, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile, mkdir, unlink, readFile, open, rename, chmod, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { Database, Storage, storageRoot } from './storage';
import { driveUrl, resourceInput, publication, signToken, verifyToken, passwordMatches, requestId, provider, publicUrl } from './security';
type Req = Request & {
    files?: any;
    file?: Express.Multer.File;
};
const text = (max = 200) => z.string().min(1).max(max);
@Controller()
export class Api {
    constructor(
    @Inject(Database)
    private db: Database,
    @Inject(Storage)
    private storage: Storage) { }
    user(r: Request, required = false) {
        const token = r.headers.authorization?.replace(/^Bearer /, '');
        if (!token) {
            if (required)
                throw new UnauthorizedException();
            return undefined;
        }
        return verifyToken(token, 'user');
    }
    identity(r: Request) {
        const user = this.user(r);
        if (user)
            return `u:${user}`;
        const visitor = r.headers['x-visitor-id'];
        if (typeof visitor === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(visitor))
            return `v:${visitor}`;
        return `ip:${createHash('sha256').update(r.ip || 'unknown').digest('hex')}`;
    }
    async limit(r: Request, type: string, max: number, seconds = 3600) {
        const identity = this.identity(r), ipIdentity = `rate-ip:${createHash('sha256').update(r.ip || 'unknown').digest('hex')}`;
        return this.db.$transaction(async (tx) => {
            const n = await tx.event.count({ where: { identity, type, createdAt: { gt: new Date(Date.now() - seconds * 1000) } } }), ipCount = await tx.event.count({ where: { identity: ipIdentity, type, createdAt: { gt: new Date(Date.now() - seconds * 1000) } } });
            if (n >= max || ipCount >= max * 3)
                throw new HttpException('Too many requests', 429);
            await tx.event.createMany({ data: [{ identity, type }, { identity: ipIdentity, type }] });
        }, { isolationLevel: 'Serializable' });
    }
    view(r: any) { const { data, sourcePath, sourceHash, sourceBytes, links, ...rest } = r; return { ...data, ...rest, availableProviders: links?.filter((l: any) => l.enabled).map((l: any) => l.provider) || [] }; }
    async resource(id: string, admin = false) {
        const r = await this.db.resource.findFirst({ where: { OR: [{ id }, { slug: id }], ...(admin ? {} : { status: 'PUBLISHED' }) }, include: { links: true } });
        if (!r)
            throw new NotFoundException('Resource not found');
        return r;
    }
    async list(q: any, admin = false) { const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 12)); let rows = await this.db.resource.findMany({ where: { ...(!admin ? { status: 'PUBLISHED' } : q.status ? { status: q.status } : {}), ...(q.categoryId ? { categoryId: q.categoryId } : {}), ...(q.q ? { title: { contains: String(q.q).slice(0, 100) } } : {}) }, include: { links: true }, orderBy: { createdAt: 'desc' } }); rows = rows.filter((r: any) => { const d = r.data; return (!q.topicId || d.topicIds.includes(q.topicId)) && (!q.difficulty || d.difficulty === q.difficulty) && (!q.ageMin || d.ageMax >= Number(q.ageMin)) && (!q.ageMax || d.ageMin <= Number(q.ageMax)); }); return { items: rows.slice((page - 1) * pageSize, page * pageSize).map(r => this.view(r)), total: rows.length, page, pageSize }; }
    async assertPublish(data: any, links: any[]) {
        publication(data, links);
        for (const url of new Set<string>([data.coverUrl, ...data.previewUrls])) {
            let local = url;
            if (url.startsWith('https://') && process.env.PUBLIC_BASE_URL) {
                const origin = new URL(process.env.PUBLIC_BASE_URL).origin;
                const parsed = new URL(url);
                if (parsed.origin === origin)
                    local = parsed.pathname;
            }
            if (local.startsWith('/assets/') && !local.includes('..') && !local.includes('\\')) {
                try {
                    await sharp(await readFile(join(storageRoot(), 'public', local.slice(8)))).metadata();
                }
                catch {
                    throw new BadRequestException('Preview file is missing or unreadable');
                }
            }
            else {
                throw new BadRequestException('Publication requires locally uploaded readable previews');
            }
        }
    }
    async save(body: any, id?: string, forced?: string) {
        const previous = id ? await this.resource(id, true) : undefined;
        const data = resourceInput.parse({ ...((previous?.data || {}) as any), ...body, ...(forced ? { status: forced } : {}) });
        if (data.ageMin > data.ageMax)
            throw new BadRequestException('Invalid age range');
        const category = await this.db.taxonomy.findFirst({ where: { id: data.categoryId, kind: 'category' } });
        if (!category)
            throw new BadRequestException('Unknown category');
        if (data.topicIds.length !== await this.db.taxonomy.count({ where: { id: { in: [...new Set(data.topicIds)] }, kind: 'topic' } }))
            throw new BadRequestException('Unknown or duplicate topic');
        if (data.status === 'PUBLISHED')
            await this.assertPublish(data, previous?.links || []);
        const values = { slug: data.slug, title: data.title, categoryId: data.categoryId, status: data.status, data };
        const saved = id ? await this.db.resource.update({ where: { id: previous!.id }, data: { ...values, version: { increment: 1 } }, include: { links: true } }) : await this.db.resource.create({ data: values, include: { links: true } });
        return this.view(saved);
    }
    async image(file: Express.Multer.File) {
        if (!file || file.size > 5 * 1024 * 1024)
            throw new BadRequestException('Image required; maximum 5 MiB');
        const bytes = file.buffer || await readFile(file.path);
        let data: Buffer;
        try {
            const metadata = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
            if (!['png', 'jpeg'].includes(metadata.format || ''))
                throw Error();
            data = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize({ width: 1800, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        }
        catch {
            throw new BadRequestException('Valid PNG or JPEG bytes required');
        }
        await mkdir(join(storageRoot(), 'public', 'previews'), { recursive: true });
        const name = `${randomUUID()}.jpg`;
        await writeFile(join(storageRoot(), 'public', 'previews', name), data);
        return `/assets/previews/${name}`;
    }
    @All('{*path}')
    async handle(
    @Req()
    req: Req,
    @Res()
    res: Response) {
        try {
            const output = await this.route(req, res);
            if (!res.headersSent)
                res.json(output);
        }
        catch (e: any) {
            if (res.headersSent)
                return;
            let status = e.getStatus?.() || 500;
            let message = e.message || 'Internal error';
            if (e instanceof z.ZodError) {
                status = 400;
                message = e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
            }
            if (e.code === 'P2002') {
                status = 409;
                message = 'Record already exists; retry idempotent requests';
            }
            if (e.code === 'P2025') {
                status = 404;
                message = 'Record not found';
            }
            if (e.code === 'P2034') {
                status = 409;
                message = 'Concurrent operation; retry request';
            }
            if (status === 500)
                message = 'Internal server error';
            res.status(status).json({ statusCode: status, message });
        }
    }
    async route(r: Req, res: Response): Promise<any> {
        const p = r.path.replace(/\/$/, '') || '/', m = r.method, b = r.body || {}, q = r.query as any;
        if (p === '/health') {
            try {
                await this.db.$queryRaw `SELECT 1`;
                return { status: 'ok', database: 'ok' };
            }
            catch {
                res.status(503);
                return { status: 'error', database: 'unavailable' };
            }
        }
        if (p === '/api/config')
            return { appName: '纸趣 PaperJoy', appId: process.env.WECHAT_APP_ID || 'wx28e18cf4675ffa9a', adsEnabled: process.env.ADS_ENABLED === 'true' && !!process.env.REWARDED_AD_UNIT_ID, rewardedAdUnitId: process.env.REWARDED_AD_UNIT_ID || '', loginEnabled: !!process.env.WECHAT_APP_SECRET || process.env.NODE_ENV !== 'production' && process.env.DEV_WECHAT_MOCK === 'true', supportContact: process.env.SUPPORT_CONTACT || '', privacyVersion: '2026-11-06' };
        if (p === '/api/admin/login' && m === 'POST') {
            const ip = `login:${r.ip}`;
            const n = await this.db.event.count({ where: { identity: ip, type: 'LOGIN', createdAt: { gt: new Date(Date.now() - 900000) } } });
            if (n >= 10)
                throw new HttpException('Too many login attempts', 429);
            await this.db.event.create({ data: { identity: ip, type: 'LOGIN' } });
            const input = z.object({ username: text(100), password: text(1000) }).parse(b);
            if (input.username !== (process.env.ADMIN_USERNAME || 'admin') || !passwordMatches(input.password))
                throw new UnauthorizedException('Invalid credentials');
            return { token: signToken(input.username, 'admin') };
        }
        if (p.startsWith('/api/admin/')) {
            verifyToken(r.headers.authorization?.replace(/^Bearer /, '') || '', 'admin');
            return this.admin(r, p, m, b, q);
        }
        if (/^\/r\/[^/]+$/.test(p) && m === 'GET') {
            const link = await this.db.driveLink.findUnique({ where: { code: p.slice(3) }, include: { resource: true } });
            if (!link || !link.enabled || link.resource.status !== 'PUBLISHED')
                throw new NotFoundException();
            driveUrl(link.url, link.provider);
            await this.db.event.create({ data: { type: 'SHORT_LINK', resourceId: link.resourceId, identity: this.identity(r) } });
            res.redirect(302, link.url);
            return;
        }
        if (m === 'GET' && ['/api/categories', '/api/topics'].includes(p))
            return this.db.taxonomy.findMany({ where: { kind: p.endsWith('categories') ? 'category' : 'topic' } });
        if (p === '/api/resources' && m === 'GET')
            return this.list(q);
        let match = p.match(/^\/api\/resources\/([^/]+)(?:\/(view|claim))?$/);
        if (match) {
            const resource = await this.resource(match[1]);
            if (m === 'GET' && !match[2])
                return this.view(resource);
            if (m === 'POST' && match[2] === 'view') {
                await this.limit(r, 'VIEW', 120);
                await this.db.event.create({ data: { type: 'VIEW_RESOURCE', resourceId: resource.id, identity: this.identity(r) } });
                return { ok: true };
            }
            if (m === 'POST' && match[2] === 'claim')
                return this.claim(r, resource, b);
        }
        if (p === '/api/user/login' && m === 'POST') {
            await this.limit(r, 'USER_LOGIN', 30);
            const code = text(512).parse(b.code);
            let openid: string;
            if (process.env.NODE_ENV !== 'production' && process.env.DEV_WECHAT_MOCK === 'true') {
                openid = `dev:${createHash('sha256').update(code).digest('hex')}`;
            }
            else {
                if (!process.env.WECHAT_APP_SECRET)
                    throw new ServiceUnavailableException('WeChat login is not configured');
                const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
                url.search = new URLSearchParams({ appid: process.env.WECHAT_APP_ID || 'wx28e18cf4675ffa9a', secret: process.env.WECHAT_APP_SECRET, js_code: code, grant_type: 'authorization_code' }).toString();
                let response: any;
                try {
                    response = await (await fetch(url, { signal: AbortSignal.timeout(10000) })).json();
                }
                catch {
                    throw new ServiceUnavailableException('WeChat exchange unavailable');
                }
                if (!response.openid)
                    throw new UnauthorizedException('WeChat code exchange rejected');
                openid = response.openid;
            }
            const user = await this.db.user.upsert({ where: { openid }, create: { openid }, update: {} });
            return { token: signToken(user.id, 'user'), user: { id: user.id } };
        }
        if (p === '/api/user/favorites' && m === 'GET') {
            const userId = this.user(r, true)!;
            const favorites = await this.db.favorite.findMany({ where: { userId } });
            return (await this.db.resource.findMany({ where: { id: { in: favorites.map(f => f.resourceId) }, status: 'PUBLISHED' }, include: { links: true } })).map(v => this.view(v));
        }
        match = p.match(/^\/api\/user\/favorites\/([^/]+)$/);
        if (match) {
            const userId = this.user(r, true)!;
            if (m === 'PUT') {
                const resource = await this.resource(match[1]);
                await this.db.favorite.upsert({ where: { userId_resourceId: { userId, resourceId: resource.id } }, create: { userId, resourceId: resource.id }, update: {} });
            }
            else if (m === 'DELETE')
                await this.db.favorite.deleteMany({ where: { userId, resourceId: match[1] } });
            else
                throw new NotFoundException();
            return { ok: true };
        }
        if (p === '/api/user/claims' && m === 'GET') {
            const rows = await this.db.claim.findMany({ where: { identity: `u:${this.user(r, true)}` }, orderBy: { createdAt: 'desc' }, take: 500 });
            const resources = await this.db.resource.findMany({ where: { id: { in: rows.map(c => c.resourceId) } } });
            return rows.map(c => ({ id: c.id, resourceId: c.resourceId, resourceTitle: resources.find(v => v.id === c.resourceId)?.title || '已下架素材', createdAt: c.createdAt }));
        }
        if (p === '/api/rewards/sessions' && m === 'POST') {
            const input = z.object({ resourceId: text(180), requestId }).parse(b), resource = await this.resource(input.resourceId), identity = this.identity(r);
            const existing = await this.db.reward.findUnique({ where: { identity_resourceId_requestId: { identity, resourceId: resource.id, requestId: input.requestId } } });
            if (existing)
                return { id: existing.id, expiresAt: existing.expiresAt };
            await this.limit(r, 'REWARD', 20);
            const reward = await this.db.reward.create({ data: { identity, resourceId: resource.id, requestId: input.requestId, expiresAt: new Date(Date.now() + 15 * 60000) } });
            return { id: reward.id, expiresAt: reward.expiresAt };
        }
        match = p.match(/^\/api\/rewards\/sessions\/([^/]+)\/complete$/);
        if (match && m === 'POST') {
            if (b.completed !== true)
                throw new BadRequestException('Viewing was not completed');
            await this.limit(r, 'REWARD_COMPLETE', 40);
            const changed = await this.db.reward.updateMany({ where: { id: match[1], identity: this.identity(r), used: false, expiresAt: { gt: new Date() } }, data: { completed: true } });
            if (!changed.count)
                throw new ConflictException('Reward session expired or already used');
            return { ok: true };
        }
        if (p === '/api/events' && m === 'POST') {
            const input = z.object({ type: z.literal('COPY_LINK'), resourceId: text(180), provider: provider.optional(), requestId: requestId.optional() }).parse(b);
            const resource = await this.resource(input.resourceId), identity = this.identity(r);
            await this.limit(r, 'COPY_RATE', 120);
            const key = input.requestId ? createHash('sha256').update(`${identity}:${resource.id}:${input.requestId}`).digest('hex') : undefined;
            if (key)
                await this.db.event.upsert({ where: { requestId: key }, create: { type: input.type, resourceId: resource.id, identity, requestId: key }, update: {} });
            else
                await this.db.event.create({ data: { type: input.type, resourceId: resource.id, identity } });
            return { ok: true };
        }
        if (p === '/api/feedback' && m === 'POST') {
            await this.limit(r, 'FEEDBACK', 10);
            const input = z.object({ resourceId: text(180).optional(), type: z.enum(['BROKEN_LINK', 'CONTENT', 'OTHER']), message: text(2000), contact: z.string().max(200).optional() }).parse(b);
            if (input.resourceId)
                input.resourceId = (await this.resource(input.resourceId)).id;
            const saved = await this.db.feedback.create({ data: input });
            return { id: saved.id };
        }
        throw new NotFoundException('Endpoint not found');
    }
    async claim(r: Req, resource: any, b: any) {
        const input = z.object({ requestId, rewardSessionId: z.string().uuid().optional() }).parse(b), identity = this.identity(r), key = { identity, resourceId: resource.id, requestId: input.requestId };
        const existing = await this.db.claim.findUnique({ where: { identity_resourceId_requestId: key } });
        if (existing)
            return existing.response;
        await this.limit(r, 'CLAIM', 30);
        return this.db.$transaction(async (tx) => {
            const replay = await tx.claim.findUnique({ where: { identity_resourceId_requestId: key } });
            if (replay)
                return replay.response;
            const links = resource.links.filter((l: any) => l.enabled).map((l: any) => ({ provider: l.provider, url: driveUrl(l.url, l.provider), extractionCode: l.extractionCode }));
            if (!links.length)
                throw new ConflictException('No download links available');
            if (resource.data.accessMode === 'REWARDED' && process.env.ADS_ENABLED === 'true' && process.env.REWARDED_AD_UNIT_ID) {
                if (!input.rewardSessionId)
                    throw new ForbiddenException('Reward viewing required');
                const bound = await tx.reward.updateMany({ where: { id: input.rewardSessionId, identity, resourceId: resource.id, completed: true, used: false, expiresAt: { gt: new Date() } }, data: { used: true } });
                if (!bound.count)
                    throw new ConflictException('Reward session expired, mismatched, or already claimed');
            }
            const id = randomUUID(), createdAt = new Date(), response = { claimId: id, links, claimedAt: createdAt.toISOString() };
            await tx.claim.create({ data: { id, ...key, response, createdAt } });
            return response;
        }, { isolationLevel: 'Serializable' });
    }
    async admin(r: Req, p: string, m: string, b: any, q: any): Promise<any> {
        if (p === '/api/admin/stats') {
            const [resources, published, claims, views, copyEvents, shortLinkVisits, openFeedback, pendingTasks] = await Promise.all([this.db.resource.count(), this.db.resource.count({ where: { status: 'PUBLISHED' } }), this.db.claim.count(), this.db.event.count({ where: { type: 'VIEW_RESOURCE' } }), this.db.event.count({ where: { type: 'COPY_LINK' } }), this.db.event.count({ where: { type: 'SHORT_LINK' } }), this.db.feedback.count({ where: { status: 'OPEN' } }), this.db.task.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } })]);
            return { resources, published, claims, views, copyEvents, shortLinkVisits, openFeedback, pendingTasks };
        }
        if (p === '/api/admin/resources') {
            if (m === 'GET')
                return this.list(q, true);
            if (m === 'POST')
                return this.save(b);
        }
        let match = p.match(/^\/api\/admin\/resources\/([^/]+)(?:\/(publish|archive|links))?$/);
        if (match) {
            const resource = await this.resource(match[1], true), id = resource.id;
            if (match[2] === 'links') {
                if (m === 'GET')
                    return resource.links.map(({ id, provider, url, extractionCode, enabled }) => ({ id, provider, url, extractionCode, enabled }));
                if (m === 'PUT') {
                    const { links } = z.object({ links: z.array(z.object({ provider, url: text(1000), extractionCode: z.string().max(32).default(''), enabled: z.boolean().default(true) })).max(2) }).parse(b);
                    if (new Set(links.map(l => l.provider)).size !== links.length)
                        throw new BadRequestException('Duplicate provider');
                    for (const l of links)
                        driveUrl(l.url, l.provider);
                    if (resource.status === 'PUBLISHED')
                        await this.assertPublish(resource.data, links);
                    await this.db.$transaction(async (tx) => {
                        await tx.driveLink.deleteMany({ where: { resourceId: id, provider: { notIn: links.map(l => l.provider) } } });
                        for (const l of links)
                            await tx.driveLink.upsert({ where: { resourceId_provider: { resourceId: id, provider: l.provider } }, create: { resourceId: id, ...l }, update: l });
                    });
                    return this.db.driveLink.findMany({ where: { resourceId: id }, select: { id: true, provider: true, url: true, extractionCode: true, enabled: true } });
                }
            }
            if (m === 'GET' && !match[2])
                return this.view(resource);
            if (m === 'PATCH' && !match[2])
                return this.save(b, id);
            if (m === 'POST' && match[2])
                return this.save({}, id, match[2] === 'publish' ? 'PUBLISHED' : 'ARCHIVED');
        }
        match = p.match(/^\/api\/admin\/(categories|topics)(?:\/([^/]+))?$/);
        if (match) {
            const kind = match[1] === 'categories' ? 'category' : 'topic', id = match[2];
            if (m === 'GET')
                return this.db.taxonomy.findMany({ where: { kind } });
            const schema = z.object({ name: text(100), slug: z.string().regex(/^[a-z0-9-]{1,180}$/), description: z.string().max(3000).optional(), coverUrl: publicUrl.optional() });
            if (m === 'POST' && !id)
                return this.db.taxonomy.create({ data: { kind, ...schema.parse(b) } });
            const row = await this.db.taxonomy.findFirst({ where: { id, kind } });
            if (!row)
                throw new NotFoundException();
            if (m === 'PATCH')
                return this.db.taxonomy.update({ where: { id }, data: schema.partial().parse(b) });
            if (m === 'DELETE') {
                const used = kind === 'category' ? await this.db.resource.count({ where: { categoryId: id } }) : (await this.db.resource.findMany()).filter(v => (v.data as any).topicIds.includes(id)).length;
                if (used)
                    throw new ConflictException('Taxonomy is in use');
                await this.db.taxonomy.delete({ where: { id } });
                return { ok: true };
            }
        }
        if (p === '/api/admin/uploads/preview' && m === 'POST')
            return { url: await this.image(r.file!) };
        if (p === '/api/admin/imports') {
            if (m === 'GET')
                return this.db.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
            if (m === 'POST')
                return this.import(r);
        }
        if (p === '/api/admin/storage/accounts') {
            if (m === 'GET')
                return (await this.db.storageAccount.findMany()).map(a => this.storage.accountView(a));
            if (m === 'POST')
                return this.storage.accountView(await this.db.storageAccount.create({ data: z.object({ name: text(100), provider }).parse(b) }));
        }
        match = p.match(/^\/api\/admin\/storage\/accounts\/([^/]+)\/(authorize|complete|check)$/);
        if (match && m === 'POST') {
            if (match[2] === 'authorize')
                return this.storage.authorize(match[1]);
            if (match[2] === 'complete')
                return this.storage.complete(match[1], text(4096).parse(b.code));
            return this.storage.check(match[1]);
        }
        if (p === '/api/admin/tasks') {
            if (m === 'GET')
                return this.db.task.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
            if (m === 'POST') {
                const input = z.object({ resourceId: text(36), baiduAccountId: text(36), quarkAccountId: text(36) }).parse(b);
                const resource = await this.resource(input.resourceId, true);
                if (!resource.sourcePath)
                    throw new ConflictException('No staged PDF is available for this resource');
                for (const p of ['baidu', 'quark'] as const) {
                    const a = await this.db.storageAccount.findUnique({ where: { id: input[`${p}AccountId`] } });
                    if (a?.provider !== p || a.status !== 'READY')
                        throw new BadRequestException(`${p} account is not ready`);
                }
                if (await this.db.task.count({ where: { resourceId: resource.id, status: { in: ['PENDING', 'RUNNING'] } } }))
                    throw new ConflictException('Resource already has an active task');
                return this.db.task.create({ data: { ...input, resourceId: resource.id, activeResourceId:resource.id, checkpoints: { baidu: { status: 'PENDING' }, quark: { status: 'PENDING' } } } });
            }
        }
        match = p.match(/^\/api\/admin\/tasks\/([^/]+)\/retry$/);
        if (match && m === 'POST') {
            const task = await this.db.task.findUniqueOrThrow({ where: { id: match[1] } });
            if (task.status !== 'FAILED')
                throw new ConflictException('Only failed tasks can be retried');
            const changed=await this.db.task.updateMany({where:{id:task.id,status:'FAILED',activeResourceId:null},data:{status:'PENDING',activeResourceId:task.resourceId,error:null}});if(!changed.count)throw new ConflictException('Task state changed; refresh before retry');return this.db.task.findUniqueOrThrow({where:{id:task.id}});
        }
        if (p === '/api/admin/feedback' && m === 'GET')
            return this.db.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
        match = p.match(/^\/api\/admin\/feedback\/([^/]+)$/);
        if (match && m === 'PATCH')
            return this.db.feedback.update({ where: { id: match[1] }, data: z.object({ status: z.enum(['OPEN', 'RESOLVED']) }).parse(b) });
        throw new NotFoundException('Admin endpoint not found');
    }
    importing = false;
    async import(r: Req) {
        if (this.importing)
            throw new ConflictException('Another import is active; retry');
        this.importing = true;
        const written: string[] = [];
        try {
            let manifest: any;
            try {
                manifest = JSON.parse(r.body.manifest);
            }
            catch {
                throw new BadRequestException('Invalid JSON manifest');
            }
            const source = r.files?.source?.[0] as Express.Multer.File;
            if (!source || source.size > 80 * 1024 * 1024 || source.size < 12 || !source.path)
                throw new BadRequestException('Valid PDF required; maximum 80 MiB');
            const handle = await open(source.path, 'r');
            try {
                const header = Buffer.alloc(5), tail = Buffer.alloc(Math.min(source.size, 2048));
                await handle.read(header, 0, 5, 0);
                await handle.read(tail, 0, tail.length, source.size - tail.length);
                if (header.toString() !== '%PDF-' || !tail.includes(Buffer.from('%%EOF')))
                    throw new BadRequestException('Valid PDF header and trailer required');
            }
            finally {
                await handle.close();
            }
            const digest = createHash('sha256');
            for await (const chunk of createReadStream(source.path))
                digest.update(chunk);
            const sourceHash = digest.digest('hex');
            if (manifest.sourceHash !== sourceHash)
                throw new BadRequestException('PDF SHA256 does not match manifest');
            const existing = await this.db.resource.findUnique({ where: { sourceHash } });
            if (existing) {
                const batch = await this.db.importBatch.findUniqueOrThrow({ where: { resourceId: existing.id } });
                return { id: batch.id, resourceId: existing.id, duplicate: true };
            }
            const sourcesDir = join(storageRoot(), 'private', 'sources');
            await mkdir(sourcesDir, { recursive: true, mode: 0o700 });
            let usedBytes = 0;
            for (const name of await readdir(sourcesDir)) {
                const info = await stat(join(sourcesDir, name));
                if (info.isFile())
                    usedBytes += info.size;
            }
            if (usedBytes + source.size > 1024 ** 3)
                throw new ServiceUnavailableException('Staged source quota of 1 GiB exceeded');
            const previews: string[] = [];
            for (const image of r.files?.previews || []) {
                const url = await this.image(image);
                previews.push(url);
                written.push(join(storageRoot(), 'public', url.slice(8)));
            }
            const data = resourceInput.parse({ ...manifest.resource, ...(previews.length ? { coverUrl: previews[0], previewUrls: previews } : {}), status: 'REVIEW' });
            if (data.ageMin > data.ageMax)
                throw new BadRequestException('Invalid age range');
            if (!await this.db.taxonomy.count({ where: { id: data.categoryId, kind: 'category' } }))
                throw new BadRequestException('Unknown category');
            const path = join(storageRoot(), 'private', 'sources', `${sourceHash}.pdf`);
            await mkdir(join(storageRoot(), 'private', 'sources'), { recursive: true, mode: 0o700 });
            await rename(source.path, path);
            await chmod(path, 0o600);
            written.push(path);
            const saved = await this.db.$transaction(async (tx) => { const resource = await tx.resource.create({ data: { slug: data.slug, title: data.title, categoryId: data.categoryId, status: 'REVIEW', data, sourceHash, sourcePath: path, sourceBytes: source.size } }); return tx.importBatch.create({ data: { resourceId: resource.id } }); });
            return { id: saved.id, resourceId: saved.resourceId, duplicate: false };
        }
        catch (e) {
            await Promise.all(written.map(p => unlink(p).catch(() => undefined)));
            throw e;
        }
        finally {
            this.importing = false;
        }
    }
}
