# PaperJoy v1 API contract

Shared implementation contract. JSON uses ISO timestamp strings and string identifiers. API base `/api`; errors use Nest-style `{statusCode,message}`. Public URLs are relative to the server origin or absolute HTTPS URLs. Do not return private filesystem paths or credentials to public endpoints.

## Resource

`{id,slug,title,summary,categoryId,topicIds:string[],tags:string[],ageMin:number,ageMax:number,difficulty:'EASY'|'MEDIUM'|'HARD',pageCount:number,paperSize:'A4',colorMode:'BW'|'COLOR',hasAnswers:boolean,materials:string[],instructions:string,coverUrl:string,previewUrls:string[],accessMode:'FREE'|'REWARDED',status:'DRAFT'|'REVIEW'|'PUBLISHED'|'ARCHIVED',sources:Source[],version:number,createdAt,updatedAt,availableProviders:('baidu'|'quark')[]}`.

Source: `{title,author,url,license,sha256?}`. Public source records may be shown for attribution. Private file locations and drive account state are admin-only.

Category and topic: `{id,name,slug,description?,coverUrl?}`.

## Public and user APIs

- `GET /health` outside `/api`: `{status:'ok',database:'ok'|'unavailable'}` with non-200 on database failure.
- `GET /api/config`: `{appName,appId,adsEnabled,rewardedAdUnitId,loginEnabled,supportContact,privacyVersion}`. Only public configuration.
- `GET /api/categories`, `/api/topics`: arrays.
- `GET /api/resources?q=&categoryId=&topicId=&difficulty=&ageMin=&ageMax=&page=1&pageSize=12`: `{items:Resource[],total,page,pageSize}`; published only.
- `GET /api/resources/:id`: Resource, published only. Stable IDs and slug lookup supported.
- `POST /api/resources/:id/view`: anonymous analytics; 204 or `{ok:true}`.
- `POST /api/resources/:id/claim` body `{requestId:string,rewardSessionId?:string}`; optional user JWT and anonymous `X-Visitor-Id`; response `{claimId,links:[{provider:'baidu'|'quark',url:string,extractionCode:string}],claimedAt}`. No links -> 409. Idempotency scoped to identity/resource.
- `POST /api/rewards/sessions` body `{resourceId,requestId}` -> `{id,expiresAt}`. `POST /api/rewards/sessions/:id/complete` body `{completed:true}` -> `{ok:true}`. Treat this as client-reported viewing, not cryptographic ad proof. Rate-limit and one-time claim binding.
- `POST /api/events` body `{type:'COPY_LINK',resourceId,provider?,requestId?}` -> `{ok:true}`.
- `POST /api/feedback` body `{resourceId?,type:'BROKEN_LINK'|'CONTENT'|'OTHER',message,contact?}` -> `{id}`. Anonymous supported, bounded and rate limited.
- `POST /api/user/login` body `{code}` -> `{token,user:{id}}`; WeChat code exchange on server. Missing configuration -> 503. Explicit development mock only outside production.
- `GET /api/user/favorites` -> Resource[]; `PUT /api/user/favorites/:resourceId`, `DELETE` -> `{ok:true}`. JWT required.
- `GET /api/user/claims` -> array `{id,resourceId,resourceTitle,createdAt}`; JWT required.
- `GET /r/:code` outside API: redirect only to validated Baidu/Quark hosts.

## Admin APIs (Bearer admin JWT except login)

- `POST /api/admin/login` `{username,password}` -> `{token}`.
- `GET /api/admin/stats` -> `{resources,published,claims,views,copyEvents,shortLinkVisits,openFeedback,pendingTasks}`.
- `GET /api/admin/resources` with public filters plus `status` -> paginated list; `POST`/`PATCH /:id` take writable Resource fields; `POST /:id/publish`, `POST /:id/archive` -> Resource.
- `GET/POST /api/admin/categories`, `/api/admin/topics`; `PATCH/DELETE /:id`.
- `GET /api/admin/resources/:id/links` -> `{id,provider,url,extractionCode,enabled}[]`; `PUT /api/admin/resources/:id/links` body `{links:[{provider,url,extractionCode?,enabled?}]}` -> saved array.
- `POST /api/admin/uploads/preview` multipart `file` PNG/JPEG -> `{url}`. Admin-only. File bytes validated.
- `POST /api/admin/imports` multipart `manifest` JSON text and `source` PDF, optional `previews` image files (ordered, first cover). Manifest `{sourceHash,resource:<writable Resource>}`; `sourceHash` is the PDF SHA256, checked server-side; -> `{id,resourceId,duplicate:boolean}`.
- `GET /api/admin/imports` -> array `{id,resourceId,status,createdAt,message?}`.
- `GET /api/admin/storage/accounts` -> sanitized array `{id,name,provider,status,lastError?}`.
- `POST /api/admin/storage/accounts` `{name,provider}` -> account.
- `POST /api/admin/storage/accounts/:id/authorize` -> `{url?,message?,status}`.
- `POST /api/admin/storage/accounts/:id/complete` `{code}` -> sanitized account; `POST /:id/check` -> account.
- `GET /api/admin/tasks` -> array `{id,resourceId,status,checkpoints:{baidu?:{status,message?},quark?:{status,message?}},attempts,error?,createdAt}`.
- `POST /api/admin/tasks` `{resourceId,baiduAccountId,quarkAccountId}` -> task; `POST /api/admin/tasks/:id/retry` -> task.
- `GET /api/admin/feedback` -> array `{id,resourceId?,type,message,contact?,status,createdAt}`; `PATCH /:id` `{status:'RESOLVED'|'OPEN'}`.

## Defaults

Ads off until configured: REWARDED resources can be claimed free. Anonymous browsing/claiming is supported; local favorites and history work without AppSecret. Mini program mock fixtures are development-only, explicitly enabled; production never falls back to fabricated live resources or download links. Imports start REVIEW, not published; publication validates source records, print metadata, readable preview and at least one enabled valid drive link. Whole PDF is private and not publicly served. Both provider checkpoints must succeed before deleting staged PDF. Single task concurrency, 1 GiB source quota, 80 MiB single-file limit. Account profiles are PaperJoy-private; no sharing old writable credentials.
