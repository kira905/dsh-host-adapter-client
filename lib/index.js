/**
 * dsh-host-adapter-client —— 客户端适配层包的 **host 半**（`exports["."]`）。
 *
 * 为什么这个包存在（P3 · 2026-09-25）：
 *   浏览器 bundle 是 `window.__ModuleLoader__.load({id, factory})` 的 CJS 形态，由宿主按
 *   `exports["./client"]` **单文件** serve（`/plugins/<id>/client.js`）⇒ 客户端**引用不到**
 *   各包 `lib/host-adapter.js` 副本（那是 ESM/CJS 服务端形态）。于是客户端 bundle 里的
 *   ctx 服务名（`slots` / `locale` / `sessions` …）与事件名（`connection/reset`）只能是裸字面量
 *   = `check-decoupling.mjs` 的 R4 违规（方案 §10.2「客户端物理不可达」）。
 *
 *   出路（方案 §10.2 / U3 交付报告 §5.3）：**新建一个"客户端适配层包"**——
 *   它的 `exports["./client"]` 落在一个**文件名为 `host-adapter.js`** 的产物上
 *   （文件名即 R4 白名单的命中条件），再让各客户端 bundle 用
 *   `require('dsh-host-adapter-client')` 取常量。宿主客户端模块表按
 *   `stripClientSuffix()` 归一（裸包名 ≡ `<pkg>/client`），跨包 require 由
 *   `dsh.client.external` 声明 + boot graph 排序保证"依赖先注册"。
 *
 * host 半为什么是"空的"：客户端模块表只登记 **loader entry**（= 被 cordis 加载的插件）
 *   的 client 面。故本包必须是一个能被 loader 加载的插件（profile `cordis.patch.yml` 用
 *   `insert` 挂载，与 `dsh-archive-sessions` 同姿势），而它在服务端**不做任何事** ——
 *   零 inject、零副作用、零路由。它存在的唯一理由是"把客户端面放进 boot graph"。
 *
 * 只读、无副作用：apply 是空函数；本文件不含任何主包事件名/服务名字面量（R4 面干净）。
 */

/** 包名（bundle / 报告 / 诊断用；与 package.json 的 name 逐字一致）。 */
export const name = '@kira905/dsh-host-adapter-client';

/** 显式空注入：不依赖任何宿主服务 ⇒ 任何主包线都能加载，不会让 entry 永久 pending。 */
export const inject = [];

/** 空插件体（**有意为空**，见文件头注）。 */
export function apply() {}
