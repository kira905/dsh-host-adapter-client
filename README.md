# dsh-host-adapter-client · DSH 客户端适配层（服务名 / 事件名唯一来源）

> **本仓是插件（只有客户端半）+ 2 个 bin（`dsh-host-adapter-deploy` / `dsh-host-adapter-sync`）；它不走 `dsh.bundle`，靠自带的 `deploy.mjs` 代劳** —— 装它 = `node deploy.mjs --dry-run` 先看计划、`node deploy.mjs` 真装（参数表见 §4.1）。
> 手工 `insert` 时注意：现网 profile patch 里写的是**裸名 entry name**（`dsh-host-adapter-client`），不是带 scope 的包名 —— 照带 scope 的包名去找会**找不到**。

## 装完自检（三条只读验法）

`<profile>` 换成你实际用的 profile（默认 `web`），`<数据根>` 换成你的 DSH 数据根（默认 `~/.dsh`）。

```powershell
# ① 组合树里有没有它（只读、约 0.6 秒、不启服务）
dsh --profile <profile> --dump-config | Select-String "dsh-host-adapter-client"
# 期望：出现一行 "# == <?>"，问的是它有没有被挂上（本仓包名 @kira905/dsh-host-adapter-client；带 scope 装的写带 scope 名、
#       老工装 / 手写的可能是裸名 —— 两种都搜一遍），同一个 id 的计数必须 == 1

# ② 组合列表里有没有它（只读）
Get-Content <数据根>/profiles/<profile>/package.json | Select-String "@kira905/dsh-host-adapter-client"
# 期望：**两处都没有是正常的** —— 本包刻意不进 `dependencies` / `dsh.profile.bundles`；
#       它的登记在 <数据根>/profiles/<profile>/node_modules/.package-map.json（deploy.mjs 写）

# ③ 命令在不在 —— 【只查存在，不执行】
Test-Path <数据根>/profiles/<profile>/node_modules/.bin/dsh-host-adapter-deploy.CMD   # 装进 profile 的
Test-Path "$env:APPDATA\npm\dsh-host-adapter-deploy.CMD"                           # npm i -g 装的
# 期望：True。两条路径按你实际用的装法挑一条
```

> 探针只做存在性检查（只看命令文件在不在，不执行任何命令）。
> 要不要用 `--help` 验，见本仓当前说明与该命令的参数表。

---

> 浏览器 bundle（`window.__ModuleLoader__.load({id, factory})`）**物理上引用不到**服务端包的
> `lib/host-adapter.mjs`。于是各客户端 bundle 里的 `ctx` 服务名（`webServer` / `settings` /
> `sessions` …）与事件名（`connection/reset` …）**只能写成裸字面量** —— 主包一升级，
> 改点就散在全生态。
>
> 本包给浏览器侧一个**可 `require()` 的常量模块**：`SVC`（服务名）+ `EV`（事件名）+ 版本号，
> 由**服务端唯一源** `lib/host-adapter.mjs` **生成**（不是手抄），带 `sourceSha256` 头，
> 可幂等重生成、可校验同源。

---

## ⚠️ 先读这段（比任何用法都重要）

1. **这是一个 DSH 插件包，不是命令行工具。** 装进 web profile 后由宿主 cordis loader 加载；
   **必须做 patch insert**（`cordis.patch.yml` 加一条 `insert`），否则客户端面不进 boot graph。
   本仓的 `deploy.mjs` **会自动做这件事**（也支持 `--verify` 只读核对）。
2. **插件登记 id = 包名 = `@kira905/dsh-host-adapter-client`**。
   历史教训：`__ModuleLoader__.load({id})` 的 id 与包名不一致时，**HTTP 200 但插件不挂载**
   （宿主按包名索引客户端模块表）。
3. **`lib/host-adapter.js` 与 `lib/host-adapter.d.ts` 是生成产物，别手改。**
   改了会在下次 `sync-client-host-adapter.mjs` 时被覆盖，`--verify` 也会判红。
4. **三个脚本的未知参数处理不一致**（详见 §4）：
   - `deploy.mjs`：**有参数白名单**（未知参数 ⇒ 退出码 2，不写盘）—— 安全。
   - `sync-client-host-adapter.mjs`：`KNOWN` 白名单，未知参数会被忽略但只做"生成/校验"，
     最坏是**写产物文件**（本仓内的两个文件），不会碰 profile。
   - 两者都实现了 `-h` / `--help`；本文件不在代码块里给帮助示例（参数表在 §4）。

---

## 1. 它解决什么问题

DSH 主包的事件名 / 服务名会随版本变（删事件、改语义、换粒度）。把字面量散落在 N 个自研包里，
**升级时改点随功能数增长**。本包把这件事收口成：

- **唯一源**：`lib/host-adapter.mjs`（纯函数、零依赖、零 IO，`SVC` + `EV` + `HOST_ADAPTER_VERSION`）
- **派生产物**：`lib/host-adapter.js`（浏览器 bundle）+ `lib/host-adapter.d.ts`（类型声明）
- **生成器**：`sync-client-host-adapter.mjs`（幂等；头里带 `sourceSha256`）
- **部署器**：`deploy.mjs`（把包装进 web profile + 加 `cordis.patch.yml` insert + 三重门禁）

消费方（其它客户端 bundle）：

```js
const A = require('@kira905/dsh-host-adapter-client')
const inject = [A.SVC.slots, A.SVC.locale]
ctx.on(A.EV.CONNECTION_RESET, handler)
```

> 消费方的 `package.json` 必须在 `dsh.client.external` 里声明本包 —— 宿主按它排序 boot graph
> （依赖先 register），否则同步 `require()` 会 MISS 模块表。

---

## 2. 仓库结构（全量文件）

```
dsh-host-adapter-client/
├── deploy.mjs                     # 装进 web profile（幂等；门禁①逃逸 import ②产物同源 ③语法）
├── sync-client-host-adapter.mjs   # 生成器：唯一源 → host-adapter.js + .d.ts（幂等 + --verify）
├── lib/
│   ├── index.js                   # host 半：空插件（inject=[] / apply(){}），只把本包塞进 boot graph
│   ├── host-adapter.js            # 生成产物：浏览器 bundle（loader id = 包名）
│   ├── host-adapter.d.ts          # 生成产物：类型声明
│   ├── host-adapter.mjs           # **唯一源**：SVC / EV / 版本（纯函数、零依赖、零 IO）
│   ├── dsh-home.mjs               # DSH home / web profile 目录解析（环境变量优先）
│   └── deploy-guard.mjs           # 部署门禁共享件（参数白名单 / 逃逸 import 扫描 / 冒烟 import）
├── README.md
├── README.en.md
├── CHANGELOG.md
├── LICENSE
├── package.json
├── .gitignore
└── .gitattributes
```

---

## 3. 装法（两条路，**都需要 patch insert**）

### 3.1 推荐：用 `deploy.mjs`

```powershell
# 只读核对：实体 vs 源码（不写盘）
node deploy.mjs --verify

# 预演：打印将写入的文件与 patch 片段（不写盘）
node deploy.mjs --dry-run

# 真装（会先备份 profile 的三份声明文件 + 既有实体目录）
node deploy.mjs

# 装进隔离环境（不碰生产 profile）
$env:DSH_HOME = '<你的测试 home>'; node deploy.mjs
```

它做三件事：

1. **备份** profile 的 `package.json` / `.package-map.json` / `cordis.patch.yml`（+ 既有实体目录）；
2. 复制 `package.json` + `lib/{index.js,host-adapter.js,host-adapter.d.ts}` 到
   `<DSH_HOME>/profiles/web/node_modules/@kira905/dsh-host-adapter-client/`；
3. `.package-map.json` 加 `packages` 条目；`cordis.patch.yml` 追加 `insert`
   （`- id: "@kira905/dsh-host-adapter-client"`；已存在则跳过）。

**不进 `profile.bundles`、不改 `profile.dependencies`** —— client 插件进 bundles 会崩
"declares no dsh.bundle"。

### 3.2 手工装（不想跑部署脚本时）

1. 把整个包目录拷到 `<DSH_HOME>/profiles/web/node_modules/@kira905/dsh-host-adapter-client/`；
2. 在 `<DSH_HOME>/profiles/web/node_modules/.package-map.json` 的 `packages` 里加：
   `"@kira905/dsh-host-adapter-client": { "url": "./@kira905/dsh-host-adapter-client", "dependencies": {} }`；
3. 在 `<DSH_HOME>/profiles/web/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: "@kira905/dsh-host-adapter-client"
      name: '@kira905/dsh-host-adapter-client'
```

4. **重启 DSH**（插件入口在 boot 期加载）。

---

## 4. 命令（**唯一权威参数表**）

### 4.1 `deploy.mjs` —— 装进 web profile

| 参数 | 说明 |
|---|---|
| （无参数） | 装进当前 `DSH_HOME`（默认 `~/.dsh` = 生产） |
| `--dry-run` | 只打印计划，不写任何文件 |
| `--verify` | 只读：逐文件比对「实体 vs 源码」 |
| `--help` / `-h` | 用法 |

- **参数白名单**：未知参数 ⇒ 退出码 `2`，**不写盘**（这是 2026-09-16 事故后立的规矩）。
- 退出码：`0` 通过 · `1` 门禁未过或部署失败 · `2` 用法/参数错误。
- 门禁（全部在写操作之前）：① `lib/` 里解析后逃出插件目录的相对 import；
  ② 生成产物与唯一源同源；③ 源文件 `node --check`。

### 4.2 `sync-client-host-adapter.mjs` —— 生成产物

| 参数 | 说明 |
|---|---|
| （无参数） | 生成（幂等：内容相同即跳过），写 `lib/host-adapter.js` + `lib/host-adapter.d.ts` |
| `--dry-run` | 预览要写的文件与 sha |
| `--verify` | 只校验不写；不一致 ⇒ 退出码 `1` |
| `--self-test` | 自检（临时目录里的假唯一源 + 内存字符串，零生产写入） |
| `--help` / `-h` | 用法 |

> 未知参数会被忽略（`KNOWN` 数组只用于帮助文本）—— 但它只会写本仓两个产物文件，不碰 profile。

---

## 5. 环境变量

| 变量 | 含义 | 缺省 |
|---|---|---|
| `DSH_HOME` | DSH home（`profiles/web/` 在其下） | `~/.dsh` |
| `BUTLER_DSH_HOME` | 同上的更高优先级覆盖（测试环境用） | 未设 |

---

## 6. 已知限制

- **只做常量收口，不做行为适配**：本包不提供"事件语义差异"的兼容层（那属服务端适配层）。
- **`dsh.profile.bundles` 为空**（刻意）：本包是 client 插件，必须走 `cordis.patch.yml` 的
  `insert`，进 bundles 会崩。
- **产物必须随唯一源重生成**：改了 `lib/host-adapter.mjs` 之后要跑生成器，否则 `--verify` 红。
- **包名带 scope** ⇒ 文件路径是 `node_modules/@kira905/dsh-host-adapter-client/`（多一层目录）；
  老布局（裸名）的 profile 需要重新部署。
- **未在真实宿主上验证挂载**（本仓发布的是源码与生成器，不含运行时实测记录）。

---

## 7. 许可

**AGPL-3.0 + 商业授权（双许可）**，全文见 [LICENSE](./LICENSE)。

个人 / 学习 / 开源项目：按 AGPL-3.0 自由使用与修改（衍生作品须同样开源）。
闭源 / 商业场景：需另行获取商业授权 —— **请通过本仓 Issue 联系**。

> **AGPL-3.0 本身不禁止商用**，它要求的是衍生作品同样开源；
> 「+ 商业授权」= 双许可（要么按 AGPL 开源、要么买商业授权）。

---

## 8. 相关仓

`dsh-butler-archive` · `dsh-diagnostics-extra` · `dsh-quality-toolkit` · `dsh-ops-toolkit` ·
`dsh-board-toolkit` · `dsh-memory-toolkit` · `dsh-imgtmpl` · `dsh-gongwen` ·
`dsh-api-balance-folded` · `dsh-notekit`（GitHub / Gitee 同名）。
