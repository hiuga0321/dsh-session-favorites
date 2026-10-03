<div align="center">

  # DSH Session Favorites

  **把常回看的会话，放在随手可取的位置**

  [English](README.md) · [MIT](LICENSE)

  [![许可证：MIT](https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-MIT-blue.svg)](LICENSE)
  [![npm package](https://img.shields.io/npm/v/dsh-session-favorites.svg?label=npm%20package)](https://www.npmjs.com/package/dsh-session-favorites)
  [![npm 下载量](https://img.shields.io/npm/dt/dsh-session-favorites.svg?label=npm%20%E4%B8%8B%E8%BD%BD%E9%87%8F)](https://www.npmjs.com/package/dsh-session-favorites)
  [![DSH Web Plugin](https://img.shields.io/badge/DSH%20Web-Plugin-0f766e.svg)](https://github.com/hiuga0321/dsh-session-favorites)
  [![DSH 支持至 0.2.1-alpha.1](https://img.shields.io/badge/DSH-%E6%94%AF%E6%8C%81%E8%87%B3%200.2.1--alpha.1-2563eb.svg)](#前置条件)
</div>

> DSH Session Favorites 是社区维护的 DeepSeek Harness（DSH）插件，并非 DeepSeek AI 官方产品。

## 你可以用它做什么

给常回看的会话加个星标，之后不用再翻侧边栏找它。

- **收藏会话**：在会话头部点星标收藏，也可以在收藏夹里添加。
- **按工作区分组浏览**：收藏按所属工作区分组，列表再长也能看清。
- **快速查找**：在列表顶部按标题搜索。
- **引入提示词**：在输入框键入 `@`，即可把已收藏的会话插入当前对话。
- **保持名称同步**：重命名收藏时，真实会话会通过 DSH 自身的重命名路径一并改名。
- **多端一致**：收藏保存在宿主端，同一 profile 下的每个标签页和浏览器看到的都是一份。
- **打开已归档收藏**：已归档的收藏仍可打开，且不会改变它的归档状态。
- **清理失效条目**：会话已被删除时会标记出来，确认后一步清理。

## 界面预览

在侧边栏底部、设置按钮上方点击 **收藏夹**：

![收藏夹弹层：按工作区分组，带搜索框与星标行，左下方是打开它的侧边栏入口](assets/screenshots/favorites-panel.png)

每条收藏都带星标，侧边栏入口显示当前 profile 的收藏数量。条目按所属工作区分组，悬停时显示重命名／移除操作。

## 前置条件

- 已能正常使用 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web，并可在终端运行 `dsh`。
- 支持的 DSH 版本：`0.1.5-rc.2` 至 `0.2.1-alpha.1`。
- Node.js 需满足 `>=22.15`。

## 安装

以下示例使用 `web` profile，请替换为你实际使用的 profile。

### 让 Agent 帮你安装

把下面这段话发给能执行本机终端命令的 Agent：

```text
请将 dsh-session-favorites 最新版安装到本机 DSH 的 web profile，使用官方 npm 源。安装后检查插件配置，并告诉我如何重新加载 DSH、打开收藏夹列表。
```

### 手动安装

在 PowerShell 中执行：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-session-favorites@latest --registry=https://registry.npmjs.org/
```

安装后重启 DSH Web，并按 `Ctrl+Shift+R` 硬刷新浏览器。侧边栏底部会出现 **收藏夹** 入口。

## 使用

| 你想做什么 | 操作 |
| --- | --- |
| 收藏当前会话 | 点击会话头部的星标 |
| 打开收藏列表 | 侧边栏底部 → **收藏夹** |
| 查找收藏 | 在列表顶部搜索框输入关键词 |
| 打开某条收藏 | 点击该行 |
| 把收藏引入提示词 | 在输入框键入 `@`，选择会话 |
| 重命名收藏 | 悬停该行 → 重命名；真实会话会一并改名 |
| 移除单条收藏 | 悬停该行 → 移除 → 确认 |
| 清理已删除的会话 | 使用列表旁的横幅提示，然后确认 |

弹出层仅通过关闭按钮关闭，因此点空白处不会让任务中断。移除收藏一律二次确认，批量清理共用同一个确认框。

收藏保存在宿主端的 `favorites` 存储域中，DSH 自身的会话数据不会被修改，也不会写入你的 DSH profile 之外的位置。

### 归档会话

已归档的收藏仍可点击，并且 **打开它不会改变它的归档状态**。插件刻意不调用 DSH 的取消归档接口，所以点开之后该会话仍然是「已归档」，只是你能正常查看内容。要真正取消归档，请用 DSH 原生的「取消归档」；两者是相互独立的两件事。如果其依赖的兼容补丁打不上，插件会如实报错而不会静默失败，打开归档收藏会降级为一条可见的提示。

### 重命名

重命名收藏会通过 DSH 自身的 `session.rename` 一并重命名真实会话，与原生侧边栏走同一条路径。如果该重命名成功、但同步插件保存的名称副本失败，会话会保留新名字，插件只记录一条告警 —— 你的重命名不会被回滚。

## 更新

要升级到新版本，用你想要的版本重跑安装命令，然后重启 DSH Web 并硬刷新浏览器：

```powershell
dsh plugin --profile web add dsh-session-favorites@latest --registry=https://registry.npmjs.org/
```

## 常见问题

### 安装后找不到入口？

先重启 DSH Web 并硬刷新浏览器，确认安装到了你正在使用的 profile。仍未显示时，确认插件已解析：

```powershell
dsh --profile web --dump-config
```

输出中应包含 `session-favorites`，且插件包必须同时声明 `dsh.bundle.patch` 与 `dsh.client.platform: "web"` —— 只声明 `dsh.client` 的包会装成普通依赖，不显示任何界面。

### 卸载插件后收藏会丢吗？

不会。收藏保存在你的 DSH profile 里，重新安装插件后列表会回来。卸载也不会删除会话或消息。

### 收藏会在多台设备间同步吗？

收藏保存在宿主端的 DSH profile 中，因此使用该 profile 的每个标签页和浏览器看到的都是同一份列表。不同的 DSH 安装各自维护自己的列表。

### 能和其他侧边栏插件一起用吗？

可以。本插件只新增一个底部入口、一个头部星标和一个 `@` 源，不修改 DSH 源码，也不接管其他插件的界面。

遇到其他问题，请提交 [Issue](https://github.com/hiuga0321/dsh-session-favorites/issues)，附上 DSH 与插件版本、复现步骤和错误信息。

## 从源码安装

<details>
<summary>开发或测试未发布改动时展开</summary>

没有构建步骤：[`src`](src) 就是发布内容，检出即可直接运行。

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

git clone https://github.com/hiuga0321/dsh-session-favorites.git
Set-Location .\dsh-session-favorites
dsh plugin --profile web add .
```

完成后重启 DSH Web 并硬刷新浏览器。

发布前的检查：

```sh
node scripts/smoke.mjs                    # 包名一致性、客户端装载、关键交互路径
node --test test/schema.test.mjs          # 存储域记录 schema
node --test test/favorites-core.test.mjs  # 收藏 CRUD 纯逻辑
node --test test/client.test.mjs          # 跨 DSH 版本的客户端契约
```

`scripts/smoke.mjs` 强制校验四处声明一致 —— [`src/package-identity.js`](src/package-identity.js)、`package.json` 的 `name`、`cordis.patch.yml` 的 `name` 与 client bundle 的 `id`。改包名时只要漏改一处就会在这里失败。

`devDependencies` 钉在 `0.1.5-rc.2`（兼容下限，也是宿主/远程契约的验证基准）。要跑真正的版本矩阵，把各版本各装一份、分别跑上面的检查即可 —— 客户端两套契约形状的夹具已经就位。

</details>

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
