#!/usr/bin/env node
// tools/sync-client-host-adapter.mjs —— 客户端适配层产物生成器（adapter P3 · 2026-09-25）
//
// 方案：docs\大管家adapter能力-方案-20260914.md §10.2（「客户端物理不可达」的出路 = 客户端适配层包）
//       docs\主包升级线U3-adapter接入收敛-20260922.md §5.3（宿主单文件 serve 的三条判据）
// 守门：本脚本自带 --verify（产物 sha/正文 ≠ 唯一源即 exit 1）；产物文件名 `host-adapter.js`
//       同时落在 tools\check-decoupling.mjs 的 R4 白名单里（`R4_SKIP_PATH` 按文件名豁免）。
//
// 干什么：
//   把**服务端唯一源** `tools\lib\host-adapter.mjs` 的 `SVC`（ctx 服务名）与 `EV`（事件名）
//   两张常量表，生成成**浏览器客户端适配层** `tools\dsh-host-adapter-client\lib\host-adapter.js`
//   （`window.__ModuleLoader__.load({id, factory})` 的 CJS 形态）+ 伴随类型声明 `.d.ts`。
//   各客户端 bundle 用 `require('dsh-host-adapter-client')` 取常量，代替裸字面量 ⇒ R4 收敛。
//
// 为什么是"生成"而不是"手写"：
//   手写 = 第二张常量表 ⇒ 与唯一源必然漂移（本项目已发生过"副本过期无人发现"，见 R5 的由来）。
//   生成 = 产物完全由唯一源决定（头里带 sourceSha256）⇒ 幂等、可校验、可复跑。
//
// 为什么产物文件名必须是 `host-adapter.js`：
//   R4 白名单按**文件名**豁免（`(^|[\\/])host-adapter\.[cm]?js$`），客户端 bundle 里必然还有
//   服务名字面量（它就是那张表的载体）。换任何别的文件名 ⇒ 唯一源自己的派生面反而成了违规。
//
// 用法：
//   node tools\sync-client-host-adapter.mjs            # 生成（幂等：内容相同即跳过）
//   node tools\sync-client-host-adapter.mjs --verify   # 只校验不写；不一致 → exit 1
//   node tools\sync-client-host-adapter.mjs --dry-run  # 预览要写的文件与 sha
//   node tools\sync-client-host-adapter.mjs --self-test# 自检（临时目录，零生产写入）
// 退出码：0 = 生成/校验一致；1 = 校验不一致或生成失败；2 = 用法错误
//
// 只读唯一源 + 只写本包产物；零第三方依赖（node >= 18）。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const VERSION = '0.1.0'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓根：本文件所在目录（发布仓布局 = 唯一源在 lib/host-adapter.mjs、产物在 lib/host-adapter.js）。 */
const ROOT = HERE

/** 唯一源（服务端适配层，唯一真相）。 */
export const SOURCE = path.join(ROOT, 'lib', 'host-adapter.mjs')
export const SOURCE_LABEL = 'lib/host-adapter.mjs'
/** 客户端适配层包名（== boot graph 的 entry id == bundle 里的 `id`）。 */
export const CLIENT_ID = '@kira905/dsh-host-adapter-client'
/** 产物（浏览器 bundle · 文件名即 R4 白名单命中条件）。 */
export const TARGET = path.join(ROOT, 'lib', 'host-adapter.js')
/** 伴随类型声明（TS 消费方 import 它需过类型检查）。 */
export const TARGET_DTS = path.join(ROOT, 'lib', 'host-adapter.d.ts')

const HEAD_MARK = 'GENERATED FILE — DO NOT EDIT'
const HEAD_END = '══ END HEADER ══'

const sha256 = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex')

/**
 * 生成头（**不含时间戳/随机值** ⇒ 产物完全由唯一源决定 = 幂等 + 可精确比对）。
 * 头部标记 `══ END HEADER ══` 便于通用解析。
 */
export function renderHeader({ sha, version, format, targetId }) {
  return [
    `// ══ ${HEAD_MARK} ══`,
    '// 本文件由 sync-client-host-adapter.mjs 生成 —— 手工修改会在下一次同步时被覆盖，',
    '// 且本包的自检（--verify / 单测）会判红（客户端面常量 ≠ 唯一源）。',
    `// source: ${SOURCE_LABEL}`,
    `// sourceSha256: ${sha}`,
    `// sourceVersion: ${version ?? 'unknown'}`,
    `// format: ${format}`,
    `// target: ${targetId}`,
    `// ${HEAD_END}`,
    '',
  ].join('\n')
}

/** 从产物文本剥掉头（与 sync-host-adapter.mjs 同口径）。 */
export function stripHeader(text) {
  const src = String(text ?? '')
  const idx = src.indexOf(HEAD_END)
  if (idx < 0) return { sha: null, version: null, body: src, hasHeader: false }
  const head = src.slice(0, idx)
  const nl = src.indexOf('\n', idx)
  const body = nl < 0 ? '' : src.slice(nl + 1)
  const m = /sourceSha256:\s*([0-9a-f]{64})/.exec(head)
  const v = /sourceVersion:\s*([^\s]+)/.exec(head)
  return { sha: m ? m[1] : null, version: v ? v[1] : null, body, hasHeader: true }
}

/** 常量表 → JS 字面量行（保持唯一源的键顺序；值一律 JSON 转义，防引号/反斜杠注入）。 */
function tableLines(table, indent) {
  return Object.entries(table).map(([key, value]) => `${indent}${key}: ${JSON.stringify(value)},`)
}

/** 生成浏览器 bundle 正文（头 + `window.__ModuleLoader__` CJS 工厂）。 */
export function renderClientBundle({ svc, ev, version, sha }) {
  const head = renderHeader({ sha, version, format: 'client-modules-cjs', targetId: CLIENT_ID })
  const body = [
    '/**',
    ' * 客户端适配层（浏览器半）：ctx 服务名 / 事件名的**唯一来源**（派生自 lib/host-adapter.mjs）。',
    ' *',
    ' * 消费方式（各客户端 bundle 内）：',
    " *   const A = require('@kira905/dsh-host-adapter-client');   // 或 require('@kira905/dsh-host-adapter-client/client')",
    ' *   const inject = [A.SVC.slots, A.SVC.locale];',
    ' *   ctx.on(A.EV.CONNECTION_RESET, handler);',
    ' * ⚠️ 消费方的 package.json 必须在 `dsh.client.external` 里声明本包 —— 宿主按它排序 boot graph',
    ' *    （依赖 row 先于消费方 register），否则同步 require 会 MISS 模块表。',
    ' */',
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(CLIENT_ID)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    "\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });",
    '',
    '\t\t/** ctx 服务名（值 == 键名，冻结；与服务端唯一源逐条同源）。 */',
    '\t\tconst SVC = Object.freeze({',
    ...tableLines(svc, '\t\t\t'),
    '\t\t});',
    '',
    '\t\t/** 主包事件名（与服务端唯一源逐条同源）。 */',
    '\t\tconst EV = Object.freeze({',
    ...tableLines(ev, '\t\t\t'),
    '\t\t});',
    '',
    '\t\texports.SVC = SVC;',
    '\t\texports.EV = EV;',
    `\t\texports.HOST_ADAPTER_VERSION = ${JSON.stringify(version)};`,
    '',
    '\t\t// ── 客户端 cordis 插件契约（必需）──────────────────────────────────────',
    '\t\t// 宿主把每个 client bundle 当**插件 entry** 加载（cordis Loader → internal.import）：',
    '\t\t// 缺 apply 会报 invalid plugin（expect function or object with an "apply" method），',
    '\t\t// 整条 entry apply 失败 —— 2026-09-25 在 3090 实测踩到，故补契约三件套。',
    '\t\t// 本包是**纯常量模块**：apply 有意为空，inject 为空（不依赖任何客户端服务）。',
    `\t\texports.name = ${JSON.stringify(CLIENT_ID)};`,
    '\t\texports.inject = [];',
    '\t\texports.apply = function apply() {};',
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n')
  return head + body
}

/** 生成伴随类型声明。 */
export function renderDts({ version, sha }) {
  const head = renderHeader({ sha, version, format: 'client-modules-dts', targetId: CLIENT_ID })
  return head + [
    '/** ctx 服务名常量表（与服务端唯一源同源）。 */',
    'export declare const SVC: Readonly<Record<string, string>>;',
    '/** 主包事件名常量表（与服务端唯一源同源）。 */',
    'export declare const EV: Readonly<Record<string, string>>;',
    '/** 唯一源版本号（tools/lib/host-adapter.mjs 的 HOST_ADAPTER_VERSION）。 */',
    'export declare const HOST_ADAPTER_VERSION: string;',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------- 载入唯一源

/** 动态 import 唯一源（纯 ESM，无副作用），取三张事实。 */
export async function loadSource() {
  if (!fs.existsSync(SOURCE)) return { error: `唯一源不存在: ${SOURCE}` }
  const src = fs.readFileSync(SOURCE, 'utf8')
  const sha = sha256(src)
  let mod
  try {
    mod = await import(pathToFileURL(SOURCE).href)
  } catch (e) {
    return { error: `唯一源 import 失败: ${(e && e.message) || e}` }
  }
  if (!mod.SVC || !mod.EV) return { error: '唯一源未导出 SVC / EV' }
  return { src, sha, version: mod.HOST_ADAPTER_VERSION ?? 'unknown', svc: mod.SVC, ev: mod.EV }
}

export function planOf(loaded) {
  const files = [
    { file: TARGET, text: renderClientBundle(loaded), label: 'client bundle' },
    { file: TARGET_DTS, text: renderDts(loaded), label: '类型声明' },
  ]
  return files.map((f) => ({ ...f, sha: sha256(f.text) }))
}

// ---------------------------------------------------------------- 自检

/**
 * 自检：把生成的 bundle 放进 vm 执行，取回 factory 真实产出的 exports，与唯一源逐一比对。
 * **断言的是值本身**（不是"返回了 truthy"）—— 这才是"生成器没写歪"的可证伪判据。
 * 全程零生产写入（临时目录里的假唯一源 + 内存字符串）。
 */
export function selfTest() {
  const ck = []
  const push = (name, ok, detail) => ck.push({ name, ok: !!ok, detail })

  const svc = { slots: 'slots', locale: 'locale', webServer: 'webServer' }
  const ev = { CONNECTION_RESET: 'connection/reset', TURN_END: 'turn/end' }
  const loaded = { svc, ev, version: '9.9.9', sha: 'a'.repeat(64) }
  const bundle = renderClientBundle(loaded)

  push('头含 sourceSha256', /sourceSha256:\s*a{64}/.test(bundle), '')
  push('产能剥头', stripHeader(bundle).hasHeader === true, '')
  push('头后正文含 loader 调用', stripHeader(bundle).body.includes('window.__ModuleLoader__.load({'), '')
  push('正文只含一次 loader 调用', stripHeader(bundle).body.split('window.__ModuleLoader__.load({').length === 2, '')

  // 真执行产物：vm 里 stub window.__ModuleLoader__，取 factory 的 exports
  let reg = null
  try {
    vm.runInNewContext(bundle, { window: { __ModuleLoader__: { load: (r) => { reg = r } } } })
  } catch (e) {
    push('vm 执行产物', false, String((e && e.message) || e))
  }
  if (reg) {
    push('bundle id == 包名', reg.id === CLIENT_ID, String(reg.id))
    let out = null
    try { out = reg.factory(() => { throw new Error('no require expected') }) } catch (e) {
      push('factory 可执行（零 require）', false, String((e && e.message) || e))
    }
    if (out) {
      push('SVC 逐条等值', JSON.stringify(out.SVC) === JSON.stringify(svc), JSON.stringify(out.SVC))
      push('EV 逐条等值', JSON.stringify(out.EV) === JSON.stringify(ev), JSON.stringify(out.EV))
      push('版本透传', out.HOST_ADAPTER_VERSION === '9.9.9', String(out.HOST_ADAPTER_VERSION))
      push(
        '客户端插件契约 name/inject/apply',
        out.name === CLIENT_ID && Array.isArray(out.inject) && out.inject.length === 0 && typeof out.apply === 'function',
        '',
      )
      push('常量冻结', Object.isFrozen(out.SVC) && Object.isFrozen(out.EV), '')
    }
  }

  // 幂等 / 头敏感性：同输入两跑逐字节相同；换 sha 则产物变
  push('幂等（同输入两跑同字节）', renderClientBundle(loaded) === bundle, '')
  push('对 sha 敏感（换 sha 产物变）', renderClientBundle({ ...loaded, sha: 'b'.repeat(64) }) !== bundle, '')

  // d.ts 也是生成物（同一头口径）
  const dts = renderDts(loaded)
  push('d.ts 含三类导出', /export declare const (SVC|EV|HOST_ADAPTER_VERSION)/.test(dts) && dts.split('export declare const').length === 4, '')
  push('d.ts 头一致', stripHeader(dts).sha === 'a'.repeat(64), '')

  // 临时目录里落一份，证明写盘路径可用（不碰生产）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-client-adapter-'))
  try {
    const f = path.join(tmp, 'host-adapter.js')
    fs.writeFileSync(f, bundle, 'utf8')
    push('写盘往返逐字节相同', fs.readFileSync(f, 'utf8') === bundle, '')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  const bad = ck.filter((c) => !c.ok)
  for (const c of ck) console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`)
  console.log(`\n[--self-test] ${ck.length - bad.length} 通过 / ${bad.length} 失败`)
  return bad.length === 0 ? 0 : 1
}

// ---------------------------------------------------------------- 入口

const KNOWN = ['--verify', '--dry-run', '--self-test']

function usage() {
  console.log('usage: node tools\\sync-client-host-adapter.mjs [--verify | --dry-run | --self-test]')
}

/** junction 下 import.meta.url（物理路径）与 argv[1]（逻辑路径）必须 realpath 后比较。 */
function isMainEntry() {
  try {
    const fromMeta = fs.realpathSync(fileURLToPath(import.meta.url))
    const fromArgv = process.argv[1] ? fs.realpathSync(process.argv[1]) : ''
    return fromMeta.toLowerCase() === fromArgv.toLowerCase()
  } catch {
    return false
  }
}

async function main(argv) {
  const unknown = argv.filter((a) => !KNOWN.includes(a))
  if (unknown.length) {
    console.error('[中止] 不认识的参数：' + unknown.join(' ') + '（本脚本只认 ' + KNOWN.join(' ') + '）')
    usage()
    return 2
  }
  if (argv.includes('--self-test')) return selfTest()

  const verify = argv.includes('--verify')
  const dryRun = argv.includes('--dry-run')

  const loaded = await loadSource()
  if (loaded.error) {
    console.error('[中止] ' + loaded.error)
    return 1
  }
  const plan = planOf(loaded)
  console.log(`[唯一源] ${SOURCE}`)
  console.log(`[唯一源] sha256 ${loaded.sha.slice(0, 16)}… · v${loaded.version} · SVC ${Object.keys(loaded.svc).length} 项 · EV ${Object.keys(loaded.ev).length} 项`)
  console.log(`[产物]   ${TARGET}  (+ ${path.basename(TARGET_DTS)})`)

  if (verify) {
    let bad = 0
    for (const item of plan) {
      const exists = fs.existsSync(item.file)
      const cur = exists ? fs.readFileSync(item.file, 'utf8') : null
      const ok = cur === item.text
      if (!ok) bad++
      console.log(`  ${ok ? '✅' : '❌'} ${path.basename(item.file)}（期望 sha ${item.sha.slice(0, 16)}…${exists ? ` · 现值 ${sha256(cur).slice(0, 16)}…` : ' · 缺失'}）`)
    }
    if (bad) {
      console.error(`[不一致] ${bad}/${plan.length} 个产物与唯一源不符 —— 跑 node tools\\sync-client-host-adapter.mjs 重新生成`)
      return 1
    }
    console.log(`[一致] ${plan.length}/${plan.length} 个产物与唯一源逐字节一致`)
    return 0
  }

  if (dryRun) {
    for (const item of plan) {
      const exists = fs.existsSync(item.file)
      const same = exists && fs.readFileSync(item.file, 'utf8') === item.text
      console.log(`  [计划] ${same ? 'SAME（跳过）' : exists ? 'WRITE（更新）' : 'NEW（新建）'} ${item.file} · sha ${item.sha.slice(0, 16)}…`)
    }
    return 0
  }

  let written = 0
  let skipped = 0
  for (const item of plan) {
    const exists = fs.existsSync(item.file)
    if (exists && fs.readFileSync(item.file, 'utf8') === item.text) {
      skipped++
      console.log(`  [跳过] ${path.basename(item.file)} 已是最新（sha ${item.sha.slice(0, 16)}…）`)
      continue
    }
    fs.mkdirSync(path.dirname(item.file), { recursive: true })
    fs.writeFileSync(item.file, item.text, 'utf8')
    written++
    console.log(`  [写入] ${path.basename(item.file)}（${Buffer.byteLength(item.text)} B · sha ${item.sha.slice(0, 16)}…）`)
  }
  console.log(`[完成] 写入 ${written} / 跳过 ${skipped}（唯一源 v${loaded.version}）`)
  return 0
}

if (isMainEntry()) {
  main(process.argv.slice(2)).then((rc) => { process.exitCode = rc }).catch((e) => {
    console.error('[异常] ' + ((e && e.stack) || e))
    process.exitCode = 1
  })
}
