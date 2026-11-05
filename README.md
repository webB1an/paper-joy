# PaperJoy · 纸趣儿童打印素材

家长可搜索、预览儿童涂色、迷宫、控笔和奖励表，并通过百度或夸克领取打印文件。首版免费领取＋可选激励广告，不接支付。

## 工程

- `apps/miniprogram`：原生 TypeScript 微信小程序，AppID `wx28e18cf4675ffa9a`。发现、分类、收藏、我的、搜索、专题、详情、领取、反馈及说明页面。
- `apps/api`：NestJS、Prisma、MySQL；管理员与用户独立 JWT、内容管理、导入、双网盘检查点任务、短链及事件统计。
- `apps/admin`：React/Vite 运营后台，暖白内容区和玻璃导航。
- `tools/content`：本地下载来源素材、生成 A4 PDF、答案校验、预览与导入工具。
- `deploy`：独立 PM2 进程、Nginx、数据库备份和版本切换。

## 本地运行

使用 Node 22（`.nvmrc`）和 MySQL 8。复制 `.env.example` 为私有 `.env`，填写数据库、两个不同的 JWT 密钥和管理员密码。生产环境禁止模拟登录。

```sh
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run seed
npm run dev:api
# 另一个终端
npm run dev:admin
```

管理端默认 `http://localhost:5173/admin/`，API 默认 `127.0.0.1:4001`。开发代理包含 `/api`、`/assets` 和 `/r`。

```sh
npm run typecheck
npm test
npm run build
```

构建后用微信开发者工具导入仓库根目录；`project.config.json` 指向 `apps/miniprogram/dist/`。源代码在 `src/`，不要编辑编译输出。小程序默认请求 `https://paper-joy.wdbzk.com/api`，演示数据关闭。正式联网需解除域名备案拦截、完成 HTTPS 并在微信后台配置请求域名。

真实数据库集成测试必须指向独立 `paper_joy_test`，通过 SSH 隧道访问；构建 API 后执行 `node scripts/integration.mjs`。脚本自行启动随机端口、临时存储目录的 API，不调用现有服务；禁用后台分发任务，只清理自己创建的记录。不要将生产库填入测试配置。Windows 下执行 Prisma generate 前应先停止占用其 DLL 的本地 API。

## 素材与交付

首批包括 12 页涂色、20 页迷宫＋20 页答案、12 页控笔与奖励表。来源 SVG 与许可台账保存在 `assets/source-materials/`；PDF、预览和导入清单在本地 `output/pdf/` 生成，详见 [内容工具说明](tools/content/README.md)。自动排版检查不代替真实试印。

后台导入只公开压缩预览，源 PDF 暂存在私有目录。双网盘分别记录上传与分享结果，仅两盘成功才删除暂存 PDF。未授权时可手工录入真实链接；没有链接的资源不可发布。事件计数代表浏览、领取、复制或短链访问，不代表实际转存或打印。

## 文档

- [实施与验收记录](docs/IMPLEMENTATION.md)
- [部署、备份与回退](docs/DEPLOYMENT.md)
- [待补配置与真机验收](docs/READINESS.md)
- [接口契约](docs/API_CONTRACT.md)
- [视觉规范](docs/DESIGN.md)
- [素材来源与许可原则](docs/CONTENT_PLAN.md)
- [Logo 文件](assets/brand/README.md)

密码、授权文件、源 PDF 与备份不进入 Git；管理账号只保存在私有配置。当前图标采用开放式蜡笔版本，可替换 `assets/brand/paperjoy-icon-v5-144.png` 以及应用内品牌资产后重新构建。
