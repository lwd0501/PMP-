# PMP- · PMP 学习平台

面向中国大陆 PMP 备考的中文学习平台，供个人学习和小范围分享使用。包含前端、账号同步后端、原创题库、数据库迁移和自动测试。

[当前在线版](https://pmp-practice-liu-20261110.sysact781394.chatgpt.site) 的访问权限由站点所有者管理；把代码上传到 GitHub 不会改变现有站点的权限或自动触发网站发布。

## 功能

- 240道中文练习：原180道原创模拟题，加60道MIT开源题中文译编；包含30个共享案例及图表题。
- 八组30题练习、90 题／120 分钟半程训练、180 题／240 分钟全程训练。
- 单选、多选、选项乱序、快捷键、刷新续考和到时交卷。
- 区分未答、答错和不确定作答；通过多次间隔复习巩固错题。
- 26 个大纲任务的诊断、首次正确率、重复练习表现、有效答题时间和自标错因。
- 收藏、个人笔记、题目标疑、JSON／CSV／Excel `.xlsx` 导入预览。
- 在线版按账号同步；本机保存与学习备份用于离线练习和记录恢复。

内置题是原创练习及MIT开源译编，不是PMI官方真题，也没有证据确认某题在2022–2026某次考试中出现。题库包含大纲定位、参考依据、预估难度与修订版本，已经做过 AI 辅助结构和逻辑复查，仍待独立 PMP 专家复核。训练成绩不表示官方通过概率。

## 直接离线刷题

用浏览器打开以下文件，无需安装依赖或登录：

```text
artifacts/PMP-上海广东-学习平台.html
```

当前完整题库：

```text
artifacts/PMP-上海广东-240题题库.json
```

`artifacts/` 中的其他90题及180题文件是保留的早期版本；当前使用上述“学习平台”文件。离线文件的记录保存在当前浏览器，可导出备份，不会自动与在线账号同步。

## 来源、历史资料与实考差距

“题库与资料”页面列出PMI公开样题、Oliver Lehmann历史版（2021–2025）及2026版、PrepCast120题和官方Study Hall入口。外部题量不计入内置240题；商业原站的题目没有被批量转载。旧链接可能更新为新题，不能凭链接创建年份给现有题标注考试年份。

使用个人题库时，点击首页“新增开源译编60题”会追加缺失的新题号，保留已有题目；没有来源元数据的旧记录显示为待核对，不猜测来源。

新增60题来自[sviless/pmp-2026-study-hub](https://github.com/Sviless/pmp-2026-study-hub)，固定版本`501eb3426d243e40bec08a08ebd84b413bc076cb`。保留英文题、原答案、原题编号、MIT署名及作者预估难度；中文逐项解析包含本平台补充。两个前提或术语容易歧义的候选题未纳入；WSJF、快速跟进、已实施变更等说明做了明示澄清。详见`THIRD_PARTY_NOTICES.md`及题目“来源、依据与难度”。

平台明确展示大纲、题型、组卷、答案依据、难度和评分六个维度的覆盖与差距。目前没有经过核验的实考试题参数与群体首答数据，不能给出可靠的相似度百分比或通过概率。作者标记“hard”仍只是预估，不能当作统计事实。

标准180题训练配置领域59/74/47，预测方法目标72题，其余为敏捷或混合。题池不足时显示偏差；自定义筛选训练按用户选择抽题，不承诺标准比例。所有训练题都计分，尚未复刻正式考试的全部交互题型及考务分段。

## 本地开发

需要 Node.js 24 或更高版本、npm。测试和本机预览使用 Node 内置 SQLite。

```bash
npm ci
npm test
npm run build
npm run build:offline
npm run test:browser
node scripts/preview.mjs
```

打开 `http://127.0.0.1:47831/`。

浏览器回归使用本机 Chrome；可通过 `PMP_CHROME_BIN` 指定可执行文件。测试会创建临时浏览器资料和内存数据库，并在结束后关闭。

本机预览使用合成测试身份和内存 SQLite 数据库，重启后测试数据库会清空。这个预览身份逻辑只用于本机 QA，不会打进生产 Worker，也不能当作生产登录系统使用。

## 构建

重新生成免登录文件和题库：

```bash
node build-offline.mjs
```

构建包含前端资源的 Cloudflare Worker：

```bash
npm run build
```

输出为 `dist/server/index.js`；数据库迁移和发布配置复制到 `dist/.openai/`。这些构建输出已经加入 `.gitignore`。

## 在线部署与账号同步

当前在线版使用 Sites 托管，后端为 Cloudflare Worker，数据库为 D1，绑定名为 `DB`。

- `.openai/hosting.json` 保留当前站点的项目标识与数据库绑定。项目标识不是访问令牌。
- 平台向服务端提供可信的 `oai-authenticated-user-id` 和邮箱头；后端按用户 ID 隔离记录。
- 新客户端使用 `/api/state/manifest` 和 `/api/state/chunks/:id`：分块校验、按变化上传，最后通过版本号原子提交目录。上传中断不会替换当前目录；无变化的轮询只读不写。
- `/api/state` 保留旧版整包读写兼容。旧记录在首次新客户端同步时迁移为分块格式，不删除原有学习内容。
- 本机使用 IndexedDB；旧 `localStorage` 学习记录在成功写入后迁移。浏览器不支持 IndexedDB 时回退本机存储，仍可导出备份。
- 已交卷会话以首次完成的快照为准，固定答案、信心、用时和成绩；两个离线完成版本按完成时间及确定性规则收敛。服务端拒绝旧客户端修改已完成答卷。
- 题目快照包含解析、案例及复核元数据；仅修改解析也不会覆盖旧快照。已有旧快照标识继续可读。
- 当前分块记录总量上限32MB，另有50000条作答事件、1000场会话和10000份题目快照的结构上限；这不是无限存储。旧整包接口仍限4MB。
- 过期且未被当前目录引用的分块保留24小时后在后续提交中清理；账号数据相互隔离。
- `/api/health` 用于检查数据库绑定及迁移是否就绪，不读取个人学习内容。
- 在其他托管环境部署时，必须配置可信身份来源和 D1 绑定；不能直接信任公网客户端自行提交的身份头。
- GitHub Pages 只能提供静态页面，本身无法承载账号同步后端和数据库。

新建独立站点时应使用新站点的项目配置。现有站点的发布凭证只在发布会话中传递，不保存在本仓库。源代码仓库不包含线上数据库、个人学习记录或账号凭证。

数据库结构在 `db/schema.ts` 中。修改结构后生成新增迁移：

```bash
npm run db:generate
```

已经应用的 `drizzle/` 迁移文件及元数据应保持不变，后续结构调整使用新迁移。

## 目录

```text
src/                  前端源文件、题库、学习逻辑与分块同步
dist/                 构建输出（不提交）
server/api.mjs        个人学习记录同步 API
server/worker.mjs     Worker 入口（esbuild 打包）
db/schema.ts          数据库表结构
drizzle/              SQL 迁移及元数据
scripts/preview.mjs   仅供本机使用的预览与合成身份
build-site.mjs        Worker 打包
build-offline.mjs     免登录单文件打包
artifacts/            可直接使用的离线版本与题库
test.mjs              题库、抽题与计分检查
learning.test.mjs     间隔复习、诊断、迁移和合并检查
server.test.mjs       SQLite、账号隔离和并发版本检查
sync.test.mjs         快照、交卷冻结、大记录和分块同步回归
scripts/browser-smoke.mjs  电脑/手机/离线/迁移浏览器回归
.github/workflows/    GitHub 自动检查
```

## 日常维护

修改 `src/` 源码，运行 `npm run format`；发布前执行 `npm run check`、`npm run format:check`、`npm test`、两种构建与浏览器回归。GitHub Actions 按相同流程检查提交和 Pull Request，不自动发布站点。

新增数据库迁移仅创建分块表，原 `learning_state` 表和已有迁移保持不变。回退服务端时应保留支持分块读取的 API；早期版本 Worker 无法理解已经迁移的云端目录，不能直接用旧 Worker 覆盖恢复。学习备份仍使用可移植的 v2 JSON 格式。

本轮完成稳定性、存储与维护基础；题库编辑管理、集中纠错、每日学习计划和 PWA 安装不包含在本轮更新中。

## 备考依据

- [PMI 中国：2026 年 PMP 考试更新](https://www.pmichina.org/certification/project-management-pmp/new-exam)
- [Scrum Guide](https://scrumguides.org/scrum-guide.html)
- [PMI：Earned Value Management](https://www.pmi.org/blog/earned-value-management)

具体考试安排以 PMI、中国大陆考试报名通知及准考信为准。
