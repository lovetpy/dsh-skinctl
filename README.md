# dsh-skinctl · 皮肤管理器

[English](#english) | 中文

轻量 DeepSeek Harness (DSH) Web GUI 皮肤管理插件：**运行时扫描已安装皮肤**（不硬编码列表），在设置页 Agent 预设之后注册「皮肤管理」一级菜单，列出官方默认 + 全部已装皮肤，一键切换激活皮肤，DSH 配置 watcher 秒级热生效、无需重启。

## 特性

- **运行时扫描**：host 半区实时扫描 profile `node_modules`，任何携带合法 `skin.json` 的包自动出现在列表——官方皮肤、自制皮肤、第三方皮肤一视同仁，零配置
- **一键切换**：点「应用」写 profile `cordis.patch.yml` managed 段（目标皮肤启用、其余 `disabled: true` 互斥），配置 watcher 热载入，页面确认后自动刷新
- **切换确认 + 重试**：客户端轮询 live loader 状态，热载入事件偶发丢失时自动重写 patch 触发重载，最多等待 12 秒兜底
- **轻量**：约 12KB，无依赖树膨胀（仅 peer 依赖 cordis）

## 安装

```sh
# 从 GitHub
dsh plugin --profile web add github:lovetpy/dsh-skinctl
```

安装后重启 `dsh web`，刷新页面，在 **设置 → Agent 预设之后** 看到「皮肤管理」菜单。

## 机制

- **扫描**：`GET /api/skin-manager/list`——host 半区扫描 profile `node_modules`（含 `@scope` 二级），读各包 `skin.json` 元数据；激活状态由 loader entry 的 `disabled` 判定；管理器自身与无 `skin.json` 的包天然不出现
- **切换**：`POST /api/skin-manager/apply`（body `{ id? }`，空 id = 恢复官方默认）——原子重写 patch managed 段（保留用户其他 patch 行与注释），DSH 配置 watcher 秒级热载入
- **皮肤判据**：包目录存在合法 `skin.json`（校验 `id` / `package` / `wiring.id` 格式）即为皮肤
- **皮肤开发约定**：`skin.json` 的 `wiring.id` 必须与该皮肤 `cordis.patch.yml` 的 insert `id` 一致，管理器才能对它做启用/禁用控制

## 边界

- 皮肤只改浏览器 DOM，不触及模型请求；本插件不引入新代码执行——只列出用户已自行安装的皮肤
- 热切换依赖 DSH 长驻表面的配置 watcher（`watchUserPatches`），冷启动 profile 同样支持
- 每次打开「皮肤管理」菜单都会重新扫描——新装皮肤即时可见

## License

MIT

---

## English

**dsh-skinctl** — a lightweight skin manager for the DeepSeek Harness (DSH) web GUI: **scans installed skins at runtime** (no hardcoded list), registers a "Skin Manager" settings section right after Agent presets, and switches the active skin in one click — hot-reloaded by the DSH config watcher within seconds, no restart.

### Features

- Runtime scan of the profile's `node_modules` — any package with a valid `skin.json` appears automatically
- One-click switch writing a managed section into the profile's `cordis.patch.yml` (mutual exclusion via `disabled: true`)
- Client-side confirmation polling with one automatic retry against missed watcher events
- ~12KB, no heavy dependencies

### Install

```sh
dsh plugin --profile web add github:lovetpy/dsh-skinctl
```

Restart `dsh web`, refresh, and find the "Skin Manager" section in Settings.
