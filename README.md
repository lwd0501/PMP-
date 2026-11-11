# PMP- · PMP 学习平台

面向中国大陆 PMP 备考的中文学习平台，适用于上海、广东等地区。包含前端、账号同步后端、原创题库、数据库迁移和自动测试。

[当前在线版](https://pmp-practice-liu-20261110.sysact781394.chatgpt.site) 的访问权限由站点所有者管理；把代码上传到 GitHub 不会改变现有站点的权限或自动触发网站发布。

## 功能

- 180 道原创模拟题，其中包含 30 个共享案例及图表、数据分析题。
- 六组 30 题练习、90 题／120 分钟半程训练、180 题／240 分钟全程训练。
- 单选、多选、选项乱序、快捷键、刷新续考和到时交卷。
- 区分未答、答错和不确定作答；通过多次间隔复习巩固错题。
- 26 个大纲任务的诊断、首次正确率、重复练习表现、有效答题时间和自标错因。
- 收藏、个人笔记、题目标疑、JSON／CSV／Excel `.xlsx` 导入预览。
- 在线版按账号同步；本机保存与学习备份用于离线练习和记录恢复。

题目是原创模拟练习，不是 PMI 官方试题或考试回忆题。题库包含大纲定位、参考依据、预估难度与修订版本，已经做过 AI 辅助结构和逻辑复查，仍待独立 PMP 专家复核。训练成绩不表示官方通过概率。

## 直接离线刷题

用浏览器打开以下文件，无需安装依赖或登录：

```text
artifacts/PMP-上海广东-学习平台.html
```

当前完整题库：

```text
artifacts/PMP-上海广东-180题题库.json
```

`artifacts/` 中的其他 90 题文件是保留的早期版本；当前使用上述“学习平台”文件。离线文件的记录保存在当前浏览器，可导出备份，不会自动与在线账号同步。

## 本地开发

需要 Node.js 24 或更高版本、npm。测试和本机预览使用 Node 内置 SQLite。

```bash
npm ci
npm test
node scripts/preview.mjs
```

打开 `http://127.0.0.1:47831/`。

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
- `/api/state` 使用版本号进行乐观并发检查。客户端按答题事件标识去重并合并冲突。
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
dist/                 前端源文件与题库模块
server/api.mjs        个人学习记录同步 API
db/schema.ts          数据库表结构
drizzle/              SQL 迁移及元数据
scripts/preview.mjs   仅供本机使用的预览与合成身份
build-site.mjs        Worker 打包
build-offline.mjs     免登录单文件打包
artifacts/            可直接使用的离线版本与题库
test.mjs              题库、抽题与计分检查
learning.test.mjs     间隔复习、诊断、迁移和合并检查
server.test.mjs       SQLite、账号隔离和并发版本检查
```

## 备考依据

- [PMI 中国：2026 年 PMP 考试更新](https://www.pmichina.org/certification/project-management-pmp/new-exam)
- [Scrum Guide](https://scrumguides.org/scrum-guide.html)
- [PMI：Earned Value Management](https://www.pmi.org/blog/earned-value-management)

具体考试安排以 PMI、中国大陆考试报名通知及准考信为准。
