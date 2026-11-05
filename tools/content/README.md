# 本地素材制作与导入

在项目根目录运行。Python 3.11+ 安装本目录 requirements.txt；Node 使用 22。

```powershell
python -m pip install -r tools/content/requirements.txt
python tools/content/fetch_sources.py
python tools/content/build_packs.py
python tools/content/test_content.py
```

输出位于 `output/pdf/`（不提交 Git）：自然涂色 12 页、迷宫 20 页及20页答案、控笔奖励表 12 页。每包含 PDF、前四页预览、来源清单和字体许可；全部标记待实际试印。涂色版式会按实际图形边界排版，将彩色区域处理为白底黑线，不改变留存的原始 SVG。

来源索引：`assets/source-materials/print-pack-sources.json`。字体来自 Google Fonts 的 Noto Sans SC，采用 OFL；嵌入字体子集并随打印包附许可。普通字体缓存位于 `.local/fonts/`。

通过后台的「批量导入」上传每包 manifest.json、source.pdf、按顺序排列的预览图；后台与脚本都会把分类 slug 换为实际 ID，请先创建对应分类：

```powershell
# 将管理员登录接口返回的 token 放入私有环境变量，勿写入脚本或命令历史。
node tools/content/import_packs.mjs
```

变量 `PAPERJOY_API_URL` 默认本地 API；`PAPERJOY_ADMIN_TOKEN` 必填。脚本仅入库 REVIEW，不添加假网盘链接、不发布。账号授权并同步完成或填写真实分享链接后，在后台完成检查和发布。
