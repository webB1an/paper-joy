# PaperJoy 管理端

React 19 + TypeScript + Vite。界面为中文，桌面与移动宽度均可使用。

- `npm run dev -w @paperjoy/admin`：启动开发服务，访问 `/admin/`。
- `npm run typecheck -w @paperjoy/admin`：静态类型检查。
- `npm run build -w @paperjoy/admin`：生成 `apps/admin/dist`，部署于 `/admin/`。

开发代理将 `/api` 与 `/uploads` 转发至 `http://localhost:4001`。生产环境须将这些路径与管理端部署于同一源，并为 `/admin/` 配置静态文件回退。登录使用服务端配置的管理员账号，代码没有默认口令。Token 仅保存在当前标签页的 sessionStorage，401 会清除登录状态。

所有列表、统计、链接、任务与账号状态均来自实际 API；没有样例业务数据或假下载链接。API 不可用时显示错误与重试操作。网盘授权与 PDF 分发需要后端配置真实适配器。

资源包导入接受现有 manifest JSON（`{sourceHash,resource}`）、原始 PDF（最多 80 MiB）与有序 PNG/JPEG 预览文件。客户端计算 SHA-256 并写入 manifest，服务端再次校验。`resource` 字段遵循 `docs/API_CONTRACT.md`；导入后需要在资源管理审核、配置链接并发布。

建议集成验收：登录及 401 退出；新建分类/专题；资源保存、来源授权、图片上传及链接保存；重复 PDF 导入；缺少网盘配置的诚实错误提示；任务两侧检查点；反馈解决与重新打开。浏览器外观验收建议使用 1440×1000 和 390×844。
