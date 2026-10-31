# v3.5.2 · 登录返回首页与公告生命周期修复

- 修复首页公告消息监听误置于学生退出登录回调的问题。
- 外层音乐盒页面每次加载首页时主动同步公告状态，避免登录返回首页时丢失或出现旧状态。
- 修正公告外壳加载时序和脚本缓存版本；保留公告自定义文本及 Windows 卡片双按钮布局。

# v3.4.7 · 首页公告整页展示与管理员登录入口

- 启用首页公告时，以主页内容区完整展示公告，不再使用模态层/遮罩；原学分总览内容暂时隐藏，点击“确定”恢复（若后台设置显示该按钮）。
- 页头管理员登录按钮始终可见，直接跳转 `/login.html`。
- 仅修改 `index.html` 与 `assets/pages/index.css`；原有接口、Gitee/GitHub 配置、学分和音乐盒逻辑保持不变。

# v3.4.6 · Gitee 学分数据读取诊断补充（2026-10-31）

**同时无法读取 GitHub 初始化状态和 Gitee 学分数据时，最先检查 Cloudflare Pages 部署环境绑定。** 两套数据库分别使用不同环境变量；GitHub 的报错不能证明 Gitee Token 一定缺失，但同一部署环境缺少两组变量的情况很常见。

1. 进入当前实际访问域名对应的 Cloudflare Pages 项目 → 设置 → 变量和密钥，区分 **Production / Preview** 环境。逐项检查 `GITHUB_TOKEN`、`GITHUB_OWNER`、`GITHUB_REPO` 与 `GITEE_TOKEN`、`GITEE_OWNER`、`GITEE_REPO`、`GITEE_BRANCH`（分支可不配，默认 `master`，若实际为 `main` 必须填写 `main`）。Token 请使用 Secret，不要上传到 GitHub 或提交到聊天中。
2. 改完环境变量后重新部署，打开 `/api/admin/check-system` 与 `/api/settings`、`/api/apps` 查看返回值（仅需自行查看错误码和文字，不需要向他人分享 Token）。GitHub 缺少绑定会返回 `503/GITHUB_CONFIG_MISSING`；Gitee 缺少绑定会返回 `503/GITEE_CONFIG_MISSING`，并列出缺少的**变量名称**。如果 Gitee 返回 HTTP 401/403，优先核对 Token 权限；如果仍返回空列表，进一步核对 Gitee 仓库所属用户、仓库名和分支是否指向原来的 `data/app.json`。
3. **不要在无法读到数据时执行初始化、清空仓库、批量删除或覆盖写入。** v3.4.5 曾在读取 `data/settings.json` 失败时返回 HTTP 200 和“启用申请”的默认值，容易误以为数据读取成功；本版改为 502/503 明确报错，并防止设置保存时先读取失败却盲写。
4. 若是 Pages 预览地址故障、正式环境正常，通常是 Preview 的环境变量未配置或与 Production 不同；请检查实际使用的环境、域名和项目。

原始 `学分申请(1).zip` 的 GitHub/Gitee 读取工具均从 `context.env` 获取凭证，原始 ZIP 不包含真实 Token。本版**未**内置或泄露任何凭证。单纯覆盖 ZIP 无法恢复 Cloudflare 上缺失的 Secret，必须在相应部署环境内配置。

**本版修正范围**：`functions/utils/gitee.js`（检查缺失绑定、路径正确编码、详细读取错误）、`functions/api/settings.js`（不再掩盖读取失败或错误覆盖）、`functions/api/apps.js`（缺少绑定返回 503）、`api-cache.js`（新版本缓存命名空间，防止旧默认设置继续被复用）、前版 GitHub 初始化检查提示、README/本地回归测试。申请入口、音乐、权限、Excel 和 ZIP 下载业务不变。

---

# v3.4.6 · GitHub 部署绑定问题排查

**复核结论**：原始 `学分申请(1).zip` 的 `functions/utils/github.js` 与 v3.4.5 完全一致，均要求 Cloudflare Pages Functions 环境中的 `GITHUB_TOKEN`、`GITHUB_OWNER`、`GITHUB_REPO`。原始 ZIP 没有 `.env`、`.dev.vars`、`wrangler.toml`，也没有这些变量的实际值。原项目原本可用，通常代表其 Cloudflare 项目/环境曾配置这些凭证；新建 Pages 项目或预览部署不一定继承。

## 如何恢复（必须在 Cloudflare 上完成）

1. 登录 Cloudflare 控制台，进入 **Workers & Pages → 对应 Pages 项目 → 设置 → 变量和密钥（Variables and Secrets）**。
2. 在当前部署使用的 **Production** 或 **Preview** 环境中配置：
   - `GITHUB_TOKEN`：真实 GitHub 访问凭证，必须以 **Secret/加密** 方式保存；
   - `GITHUB_OWNER`：`data/adminuser.json` 所在 GitHub 仓库的用户或组织名；
   - `GITHUB_REPO`：该 GitHub 仓库名（不是 URL）；
   - `GITEE_TOKEN`：Gitee 凭证，**Secret/加密**；
   - `GITEE_OWNER`、`GITEE_REPO`：Gitee 仓库所有者和仓库名；
   - `GITEE_BRANCH`：分支，默认 `master`，如实际是 `main` 需对应设置。
   - `ABOUT_SESSION_SECRET`：可选独立签名密钥；没有时原程序使用 `GITEE_TOKEN`。
3. 保存后 **重新部署** 当前项目，使 Pages Functions 获得环境绑定。请确认线上域名/预览地址对应的是刚配置的那个项目和环境。
4. 浏览器访问 `/api/admin/check-system`：配置完整、仓库可访问时应返回 `{"exists":true}`（如果真正未初始化才返回 false）。如果仍返回 `GITHUB_CONFIG_MISSING`，检查响应的 `missing` 字段中的变量**名称**，不要把 Token 发到聊天或前端代码里。
5. GitHub Token 需有读取仓库 `data/adminuser.json` 的权限；还需写入权限才能新建/管理账户及记录日志。GitHub API 401/403/404 等错误代表其他配置/授权问题，而不是一定需要初始化 system。

**为什么不能只靠 ZIP 自动修复？** 环境变量由 Cloudflare 保存并注入到 `context.env`，ZIP 无法读到旧项目中的加密密钥。为了安全，本包未内置任何真实 Token。`.dev.vars.example` 仅包含无效占位符，只供本地开发参考，不会自动生成云端绑定。

## 本次极小范围代码改动

- `functions/api/admin/check-system.js`：缺少 GitHub 绑定时返回 HTTP 503 + `GITHUB_CONFIG_MISSING`，仅列出**缺失变量名**；不再把部署配置问题与“系统未初始化”混淆。
- `assets/app.js` / `login.html`：初始化状态检查失败时显示有针对性的配置说明，只有真正取得系统状态结果才显示“创建 system 账户”。
- 本地样例 `.dev.vars.example` 和密钥排除规则 `.gitignore`。**没有**在代码、ZIP 或前端中嵌入凭证。
- 保留 v3.4.5 全部申请入口、公告、音乐盒、Vue、Excel、审核与下载功能不变。

## 本地验证

`node tests/v346_github_config.mjs`、`node tests/compile-views.cjs`，其他原版模拟测试可继续使用。需要在实际 Cloudflare 项目中另行验证绑定是否存在，离线测试不能替代。

---

# v3.4.5 · 学分申请入口与主页公告修复（仅两项功能）

在 **v3.4.4** 完整工程上修复，其他业务逻辑和样式保持不变。

1. **关闭学分申请入口**：system 管理页的 `enabled` 配置保存后，访问 `/upload.html` 会实时重新获取设置；关闭时显示 `/close.html` 的现有服务关闭通知和自定义提示文字。开启时恢复原学生登录校验及提交申请流程。后端 `POST /api/apps` 也检查 `enabled`，关闭时返回 HTTP 403，不能绕过页面直接新增申请；已有申请的修改审核接口不受影响。`GET /api/settings` 由 Cloudflare 中间件明确设为 `no-store`，避免开关刚保存仍命中旧数据。
2. **主页公告**：从通用 `showAlert` 改为与文件上传关闭通知同风格的居中通知卡片，支持多行文字并适配深浅色/手机端；system 管理的“主页公告”里增加 **是否显示确定按钮** 开关（`announcementShowConfirm`）。默认显示以兼容旧设置。隐藏按钮时首页通知会一直显示，直到公告被关闭或设置为显示按钮。公告仍由 `announcementEnabled` 开关决定是否出现。

部署：完整覆盖前后端文件；Gitee `data/settings.json` 不需要人工修改，缺失的新字段按“显示按钮”处理。无需新增环境变量。只更改上述两项，原上传文件入口开关、NBS 音乐盒、Excel 和 ZIP 下载逻辑未改动。

本地回归：`node tests/compile-views.cjs`、`node tests/v345_entry_announcement.mjs`、`python tests/v345_notice_layout.py`。在线上预览环境再以 system 保存开关并用学生账户验证一次真实 Gitee 配置读取和申请接口。

---

# 学分申请系统 Vue 3 · v3.4.4 曲库标题底色及禁用危险按钮可读性修复版

以 v3.4.3 完整工程为基础，**本次只修改前端样式与缓存版本**，没有更改音乐 API、删除流程、权限规则、文件下载及 Gitee 数据结构。

## 本次修复

1. **音乐库标题栏背景**：移除 `assets/core.css` 中遗留的 `.music-manager-toolbar` 通用软色背景规则；在 `assets/pages/music.css` 对工具栏明确设置透明背景、零边框与零内边距。现在“音乐库 · 41 首”一行不再出现独立底色，曲库主卡片依旧保留主题背景。
2. **修复音乐管理按钮样式被全局覆盖**：旧核心 CSS 曾把曲库工具栏所有按钮强制改为灰色，覆盖了“导入 MP3”主按钮及红色删除按钮。已移除这条旧规则，各按钮采用曲库页面自身定义的蓝色导入、常规刷新、红色危险操作样式。
3. **红色按钮禁用可读性**：禁用的 `.btn-danger`、`.btn-logout`、`.music-danger-btn` 与 `.music-delete-confirm` 使用统一的双主题低饱和背景和高对比度文字，**不再整体降低透明度**。禁止操作时使用 `not-allowed` 指针，不显示“busy”或等待光标。非危险按钮保持适度禁用弱化。
4. **缓存更新**：15 个入口 HTML 中的 `core.css` 查询版本升级为 `3.4.4`，音乐页的 `music.css` 查询版本也升级为 `3.4.4`，避免部署后沿用旧 CSS。

## 本地测试

- 15 个 Vue 业务页面和应用框架模板编译通过；JavaScript 语法检查通过。
- Chromium 模拟 41 首 MP3 的曲库管理界面，在宽度 320、390、768、1280px 和两种主题下确认标题栏透明、导入按钮颜色、批量选择、卡片布局。
- 禁用红色按钮文本对比度（WCAG 相对亮度）：浅色 **7.47:1**，深色 **9.33:1**；并检查 admin、学生、审核与申请详情页上的同类按钮。
- 路由预检查、历史文件名下载代理、音乐库 API/权限/Range 模拟通过；Cloudflare 后端 `functions/` 与 v3.4.3 逐文件一致。
- 实际 Cloudflare/Gitee 写入及手机实机表现仍需部署到预览环境验证。

## 部署

完整覆盖 v3.4.3 前端文件即可，推荐仍使用本 ZIP 完整部署。**不需要新增环境变量或迁移任何数据**。如线上静态缓存仍未更新，可在浏览器强制刷新。

---

# 学分申请系统 Vue 3 · v3.4.3 全站状态配色与 NBS 曲库布局修复版

基于 v3.4.2 完整工程（2026-10-20），保持现有业务接口、角色权限及数据格式不变。

## 本次修复

1. **未初始化与未登录状态可读性**：管理员登录页 `系统尚未初始化` 卡片由固定白底/深蓝标题改为根据主题显示；首页 `您还未登录` 卡片标题、说明和登录按钮随主题同步。补充错误重试、通用空列表、消息提示、登录表单和系统初始化表单的主题规则。深色背景下不再叠加白底浅字，浅色模式下对比度也保持正常。
2. **音乐库管理页面重整**：重写 `assets/pages/music.css`，移除旧版本残留的重复布局补丁。每首歌单独显示为有边框的卡片，卡片间隔 13px；长文件名可折行；播放/删除按钮与选择框在 320px 手机屏幕上也不超界。`删除选中` 在不可用时改为 `not-allowed` 鼠标指针，不再使用全局 `wait`。保留 Vue 选择、批量删除确认和上传功能。
3. **用户提供的设置图片**：把本次上传的罗盘图片原始字节保存为 `assets/icons/罗盘设置图标.png`，应用到普通用户、学生、admin、system 的侧边栏「设置」图标和设置页标题及外观区域。原始上传文件名为 `.gif`，但内容实际上是静态 PNG 图片，所以以 PNG 保存，不会误称其有动画。
4. **系统初始化页图标**：`create-system.html` 使用与管理员登录页面一致的 `/assets/icons/后台管理.gif` 资源，不再使用文字/Emoji 图标。
5. **缓存版本**：所有业务页面的 `core.css`、`app.js` 和本次修改页面的样式查询版本升级为 `v=3.4.3`，减少线上旧缓存与新页面混用。

## 本地验收

- 15 个 Vue 业务页面与应用框架模板编译通过；双主题、15 页面默认状态颜色检查通过。
- 单独构造 `系统尚未初始化`、`您还未登录` 状态，Chromium 测试其深浅背景与文字颜色。
- NBS 管理列表模拟九首长文件名歌曲：320、390、768、1280px 两种主题下卡片间距、按钮不溢出以及禁用按钮指针均通过。
- system/admin 软件设置权限、审核工作台四种屏宽回归，以及音乐库 Gitee CRUD/Range 模拟、路由权限和文件下载代理测试通过。
- Cloudflare Functions、串行 ZIP 下载控制器不改动。**真实云端环境、微信浏览器、手机实机与音乐播放仍需在 Cloudflare Pages 预览部署验证**。

## 部署

将 ZIP 根目录的所有文件完整部署到 Cloudflare Pages，可覆盖 v3.4.2。无需新增环境变量，不需要迁移 Gitee/GitHub 数据。首次访问若看到旧缓存建议重新加载。新增 PNG 图标必须连同 `assets/icons` 文件夹一起部署。

---

# 学分申请系统 Vue 3 · v3.4.2 主题可读性与软件设置集中版

在 v3.4.1 完整工程上进行本次修复（2026-10-20），保持 22 个 Cloudflare Pages Functions 后端文件和串行 ZIP 下载逻辑不变。

## 重点更新

1. **深浅主题文字对比度**：对 15 个 Vue 页面（含独立设置页）进行了深浅两种主题的浏览器可见文字对比度抽检。修复深色审核台权限文字、申请/文件上传标题、服务关闭提示，以及浅色上传帮助文字、选项卡和次要说明等颜色冲突。前景/背景均由统一的 Vue 主题变量驱动，不额外改动页面几何尺寸。
2. **增加软件设置页**：`settings.html`、`assets/pages/settings.css`。学生、访客、admin、system 在各自侧边栏均有「设置」入口。可更改浅色/深色、启用音乐盒、启动时自动播放、灵动岛显示、顺序/随机/单曲循环、清理本地 MP3 缓存、打开播放列表。主题由原 `assets/theme.js` 统一维护并跨内嵌页面同步；音乐偏好仍保存在原 `credit:nbs:options:v2`，不需要迁移。
3. **软件设置统一入口**：普通业务页顶部主题按钮移到设置页面；登录/初始化等无侧栏页面继续保留顶部主题按钮。NBS 抽屉只保留播放器、曲目列表和前往设置入口，设置开关统一由新设置页管理。播放器提供与设置页同源可调用的设置 API。
4. **system 专属关于信息**：原系统管理「（关于）系统信息设置」的编辑表单迁入设置页底部，保留 `PUT /api/about` 和原签名登录令牌，admin/学生/访客不可编辑；旧管理选项卡保留跳转提示兼容历史书签。业务类上传截止时间、审核和用户权限仍保留在原系统管理页面，不混入个人软件偏好。
5. **移动适配与无障碍**：设置页适配 320–1280px 屏宽，开关有可点击的文字标签，系统开启「减少动态效果」时不显示额外控件动画。不会强制绕过浏览器的音频自动播放限制。

## 测试及限制

- Vue 3 编译：15 个内嵌业务页 + 应用框架；音乐外壳继续沿用原 Vue 播放器。
- 离线 Chromium：15 页 × 2 主题的可见普通文字对比度检查、system/admin 四种屏宽的软件设置交互测试、音乐设置状态调用及权限隔离。
- `tests/v32_admin_vue.py` system 管理页面 4 种屏宽回归通过；既有文件、音乐、路由和关于接口单元测试通过。
- `tests/v34_application_vue.py` 完整上传流程的长时浏览器测试在本环境超时，不视为通过；申请页的 Vue 编译与深浅色可见文字检查已通过，传输控制器保持原状。
- 云端 Gitee/GitHub 写入、微信预览与移动设备实机行为尚需部署到 Cloudflare Pages 预览环境确认。

## 部署

将此 ZIP 根目录的全部文件完整部署到 Cloudflare Pages。前端共享资源查询版本已提升至 `v=3.4.2`，以避免混用旧资源。无需修改环境变量、后端接口及现有仓库数据。建议先预览，再切换生产。

---

# 学分申请系统 Vue 3 · v3.4.1 加载主题及动效修复版

在 v3.4 完整验收版基础上的小范围界面修复（2026-10-20）。

- **深色首屏零闪白**：所有 15 个 HTML 入口（14 个业务页面与音乐播放器外壳）在任何异步 CSS / Vue 加载前应用已保存的主题背景；页面初始化、路由预检查、错误重试与各类骨架屏均读取同一套深浅色变量。同步补全解析后 `theme-color` 标签，以避免浏览器工具栏颜色与界面不一致。
- **关于页面图标**：移除旧蓝色文字“学”，改用之前提供的 `网页选项卡标题，网站logo.webp` 图片；不修改用户上传的原图。
- **柔和过渡动画**：桌面侧边栏和顶部栏轻微滑入、页面内容渐显；鼠标悬停导航图标有小幅位移效果；移动侧边栏使用平滑抽屉动画，并支持系统的“减少动态效果”。所有动画只作用于视觉，不改变控件的实际位置与尺寸。
- **音乐盒页面切换**：在内嵌业务页加载完成前隐藏尚未准备的 iframe，避免 `about:blank` 短暂露出白色底；加载遮罩与播放器使用同一套主题。音乐本身在切页时仍由外壳保持播放。

**部署：** 解压后部署 ZIP 根目录全部文件到 Cloudflare Pages。关键资源查询版本更新为 `v=3.4.1`，建议使用 Cloudflare Pages 预览环境先验收。接口、原始用户数据与 Cloudflare 后端文件未改动。

**限制：** 浏览器首次访问、未保存主题时仍默认浅色；需要已有深色主题偏好才会从首屏使用深色。生产 CDN、Gitee 写入和手机实机仍需线上验证。

---

# 学分申请系统 · Vue 3 v3.4 最终验收版

**发布日期：2026-10-20**　|　基于 v3.3 完整工程　|　Cloudflare Pages Functions + Gitee/GitHub

## v3.4 完成内容

1. **申请提交页最后一块旧 DOM 逻辑 Vue 化**：`upload.html` 的证明图片添加、删除、计数、放大预览，活动信息表单、提交按钮的处理中状态都使用 Vue 的 `v-model`、`v-for` 和响应式状态。`assets/controllers/upload.mjs` 仅保留图片解码/Canvas 压缩、FormData 组装和 XHR 网络操作；不再执行 `innerHTML` 拼图或手工绑定按钮事件。
2. **更稳定的提交流程**：验证必填和至少一张证明、最多两张证明；图片全部压缩成功后再显示（避免部分失败造成混合状态）；正在压缩或上传时锁定重复提交；请求失败恢复按钮；成功后才跳转；页面卸载时释放图片对象 URL 和计时器。
3. **界面一致性**：提交页响应式图片卡片及放大预览使用核心 CSS 主题变量，沿用整站深浅色、四种屏宽布局。日期控件统一使用原生 `datetime-local`，不需要额外加载 Flatpickr，提交给后端的时间文本仍是 `YYYY-MM-DD HH:mm`。
4. **完整回归**：路由初始化、system 权限、审核通过/驳回/封禁、文件列表与下载、消息、学生列表、Excel 设置/导入/导出、文件上传进度、歌曲管理、深浅色与悬浮球位置。
5. **缓存更新**：全部入口 HTML 的应用与核心样式资源版本号更新到 `v=3.4`，避免部署后混用旧脚本。并添加 v3.4 提交申请页 Chromium 回归脚本。

## 功能验收清单（本地测试）

| 检查项 | 结果与覆盖 |
| --- | --- |
| Vue 3 视图编译 | 14 个页面 + 公共框架通过 |
| 申请创建及附件 | 320 / 390 / 768 / 1280px；图片选取/预览/删除、验证、XHR 失败解锁通过 |
| 审核工作台 | 320 / 390 / 768 / 1280px；通过、驳回修改、已审删除；system/admin 权限、失败恢复通过 |
| system 管理 | 320 / 390 / 768 / 1280px；学生、消息、日志、维护、提交状态通过 |
| 文件规则与 Excel | 4 种屏宽的 system 设置及导入通过；已交/未交 Excel 导出模拟通过 |
| 文件上传进度 | 320 / 390 / 1280px；上传进度与完成关闭通过 |
| 学分详情/文件管理 | 详情编辑/取消、文件名解码/下载及删除按钮模拟通过 |
| 学生端消息与列表 | 320 / 390 / 768 / 1280px 通过 |
| 全站主题/悬浮球 | 主题及悬浮位置回归通过 |
| Cloudflare API | 路由、关于、下载、音乐 CRUD/Range 与签名授权模拟通过 |
| 后端一致性 | 22 个 `functions/**/*.js` 文件与 v3.3 内容一致 |

这些测试采用**本地 Chromium + 模拟接口**，不是公网实机联网验收。**尚未验证真实 Cloudflare/Gitee/GitHub 数据写入、线上 CDN 缓存、iOS/Android 后台播放行为及微信 Excel 预览**。对于重要生产数据，请先在 Cloudflare Pages Preview 环境测试，再发布正式版本。

## 快速测试

项目根目录执行：

```bash
node tests/compile-views.cjs
python tests/v34_application_vue.py
python tests/v31_dashboard_vue.py
python tests/v32_admin_vue.py
python tests/v33_excel_settings.py
python tests/v33_upload_modal.py
python tests/v33_export_and_cancel.py
python tests/v27_theme_position.py
python tests/v29_vue_pages.py
python tests/v30_detail_files.py
node tests/v16-route-preflight.cjs
node tests/v17-about-api.mjs
node tests/v19-download-regression.cjs
node tests/v22_music_api.mjs
```

Python 浏览器用例需要安装 Playwright，且本机存在 Chromium。浏览器路径在测试文件中默认配置为 `/usr/bin/chromium`，Windows 上请修改为实际安装路径。测试数据均为本地模拟，不会写入生产环境。

## 部署与恢复

- 将 ZIP **根目录内容**部署到 Cloudflare Pages，保留 `functions/`、`assets/`、`vendor/` 和全部 HTML，勿只更新单独页面。
- 沿用 v3.3 的环境变量、Gitee/GitHub 数据路径及权限设置，**不迁移数据库**。请先在预览环境验证两种管理员账户、学生提交审核、文件上传、批量下载、Excel 导出、音乐盒首次播放。
- 生产部署前备份上一个可用版本。若线上出现问题，可直接将 v3.3 全工程重新部署回滚；后台数据结构没有变化。
- 音乐的**有声自动播放仍受浏览器用户手势限制**，不能靠脚本强制绕过。

## 代码结构与遗留边界

Vue 3 已负责页面主要列表、表单、选项卡、对话框、主题与进度状态。`assets/core.css` 和页面 CSS 仍用于响应式布局、颜色变量及动画。为了不改动已投入使用的接口协议，`assets/controllers/admin.mjs`、`file-upload.mjs` 等文件仍保留部分业务数据请求、XHR/ZIP/XLSX 工具和兼容桥接；**v3.4 是最终验收候选版，不代表所有旧控制器均被完全删除**。完整的线上验收需要持有部署与接口凭证的测试环境。

---

## 旧版说明（v3.3，供追溯）

# 学分申请系统 · Vue 3 v3.3（上传参数、Excel、进度弹窗 Vue 迁移）

在 v3.2 的完整工程上继续渐进式迁移。沿用 Cloudflare Pages Functions、原有 Gitee/GitHub 数据结构及权限规则，不更换音乐盒播放器、ZIP 串行下载算法或后端环境变量。

## v3.3 主要改动

1. **system 文件上传规则**（`admin.html`）：文件入口、是否允许多文件、最大提交次数、20/50/100/自定义 MB、无限制/相对时长/具体日期截止全部改用 Vue `v-model` 和计算属性；保存时验证整数、日期与时长，Vue 控制保存按钮和成功/失败反馈。保留 `/api/settings` 字段结构及实际存储逻辑。数据库中已有的截止时间会转换为**本地时间**输入，而不是误用 UTC 小时。
2. **学生 Excel 批量导入**（system）：导入按钮、选中文件、逐条进度、成功/失败数量和失败行详情由 Vue 响应式渲染；只从工作表读取姓名、学号、可选密码，学号按字符串提交以保护已有的前导零。写入仍依次 POST `/api/students`，避免 Gitee 数据更新冲突；导入失败详情可展开查看。`.xlsx` 使用原站内兼容库，旧 `.xls` 按原方案按需载入 SheetJS。
3. **提交状态 Excel 导出**：导出按钮由 Vue 控制忙碌及禁用状态，导出结果使用 Vue 文本反馈，数据源取已交/未交 Vue 列表，学号以字符串导出。保留原 XLSX 工具、文件名规则和列名。
4. **文件上传页**（`file-upload.html`）：姓名与学号、上传要求提示、多文件限制及截止倒计时由 Vue 显示；上传进度弹窗由 Vue `v-if` 和响应式文件列表、进度条、服务器处理中状态管理，失败/取消时自动解锁。保留 XHR 上传及 `FormData` 传输、图片压缩、文件大小验证和现有后端响应处理。
5. **CSS**：仅保留表单行排列、倒计时卡片和进度弹窗需要的样式，不增加新一套主题覆盖；不修改原有主题体系。所有 14 个静态业务入口页引用 `app.js?v=3.3` 和 `core.css?v=3.3`，更新了上传页 CSS 版本号。

## 验证方式

```bash
node tests/compile-views.cjs
python tests/v33_excel_settings.py
python tests/v33_upload_modal.py
python tests/v33_export_and_cancel.py
python tests/v32_admin_vue.py
node tests/v16-route-preflight.cjs
node tests/v19-download-regression.cjs
node tests/v22_music_api.mjs
```

新增测试使用**离线 Chromium + 模拟接口**分别覆盖 320/390/768/1280px 的系统设置和 Excel 导入、320/390/1280px 的上传进度弹窗，以及提交状态的两种 Excel 导出。旧版管理、审核及文件业务测试也可继续执行。**离线模拟不能替代 Cloudflare/Gitee 真实联网验收。**

## 部署与余下工作

压缩包根目录即 Cloudflare Pages 根目录；完整覆盖 HTML、`assets/`、`vendor/`、`functions/`。不需要修改环境变量或迁移 Gitee 数据；建议先部署到 Pages Preview 测试 system 保存上传规则、xls/xlsx 导入、文件上传取消、学号前导零和提交状态导出。

v3.3 并不意味着全站没有旧 DOM 控制器。`assets/controllers/upload.mjs` 的申请证明图片预览、部分旧管理员创建/密码操作、文件传输事件、原有工具库仍保留兼容逻辑；v3.4 以整站回归、剩余兼容层清理及真实部署验收为主。

**版本 v3.3 · 2026-10-20**


## v3.4.9 公告全屏修复
首页公告启用时在音乐盒父级页面显示整页公告，覆盖侧边栏、顶栏和音乐盒悬浮窗，仅保留管理员登录按钮以及按后台设置展示的确定按钮。公告正文保持原始自定义文本。


## v3.5.0 公告卡片 UI
全屏公告仍隐藏侧边栏、顶部栏和音乐盒；白色背景中间改为 Windows 对话框风格的卡片显示后台配置的公告标题/内容及可选确定按钮。管理员登录按钮始终位于右上角。公告不是模态，不改变内容或数据读取逻辑。


## v3.5.1 公告按钮并排
公告卡片底部操作行同时展示“管理员登录”和后台可选的“确定”按钮。关闭“确定”时仅隐藏确定按钮，管理员登录保留。纯白背景、外层公告及音乐盒隐藏逻辑不变。
