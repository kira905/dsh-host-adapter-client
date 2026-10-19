// dsh-host-adapter-client / deploy.mjs —— 客户端适配层包部署（幂等）
//
// 干什么（P3 · 2026-09-25）：
//   把本包（host 半 = 空插件 + client 半 = 生成的 host-adapter.js）装进 web profile，
//   让宿主把它纳入 **client boot graph**（`window.__DSH_BOOT__` 的 entries），
//   其它客户端 bundle 才能 `require('dsh-host-adapter-client')` 取常量。
//
// 三步（照 dsh-archive-sessions 的 insert 挂载姿势）：
//   1) 备份 profile 的 package.json / .package-map.json / cordis.patch.yml（+ 既有实体目录）
//   2) 复制 package.json + lib/{index.js,host-adapter.js,host-adapter.d.ts} 到
//      profiles\web\node_modules\dsh-host-adapter-client\
//   3) .package-map.json 加 packages 条目；cordis.patch.yml 追加 insert（已存在则跳过）
//   **不进 profile.bundles / 不改 profile.dependencies**（client 插件进 bundles 会崩
//   "declares no dsh.bundle" —— 见 profile cordis.patch.yml 的既有注释）。
//
// 门禁（全部在**任何写操作之前**）：
//   ① lib/ 里「解析后逃出插件目录的相对 import」（装进 profile 后必崩）
//   ② 生成产物必须与**唯一源**同源（跑 `tools\sync-client-host-adapter.mjs` 重新推导比对）
//   ③ 源文件语法（node --check）
//
// 用法：
//   node deploy.mjs                       # 装进当前 DSH_HOME（默认 ~/.dsh = 生产）
//   DSH_HOME=<path> node deploy.mjs       # 装进指定 DSH_HOME（隔离测试环境用这个）
//   node deploy.mjs --dry-run             # 只打印计划，不写任何文件
//   node deploy.mjs --verify              # 只读：逐文件比对「实体 vs 源码」，不写任何文件
// 退出码：0 通过 / 1 门禁未过或部署失败 / 2 用法或参数错误。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { webProfileDir } from './lib/dsh-home.mjs'
import { parseArgs, describeUnknown, findEscapingImports, EXIT } from './lib/deploy-guard.mjs'
import { loadSource, planOf } from './sync-client-host-adapter.mjs'

const SRC = path.dirname(fileURLToPath(import.meta.url))
const PKG_NAME = '@kira905/dsh-host-adapter-client'
const PLUGIN_ID = '@kira905/dsh-host-adapter-client'

// 部署到实体目录的文件（相对路径成对：[源码侧, 实体侧]）
const DEPLOY_FILES = [
  ['lib/index.js', 'lib/index.js'],
  ['lib/host-adapter.js', 'lib/host-adapter.js'],   // 生成产物（浏览器半）
  ['lib/host-adapter.d.ts', 'lib/host-adapter.d.ts'], // 生成产物（类型声明，供 TS 消费方）
  ['package.json', 'package.json'],
]
const CHECK_FILES = ['lib/index.js', 'lib/host-adapter.js']

// ── 参数白名单（fail-closed，**必须放在一切写操作之前**）──────────────────────
const KNOWN_ARGS = ['--dry-run', '--verify']
const pa = parseArgs(process.argv.slice(2), KNOWN_ARGS)
if (!pa.ok) {
  console.error('[中止] ' + describeUnknown(pa.unknown, KNOWN_ARGS) + '；只读比对请用 --verify（不写任何文件）')
  process.exit(EXIT.USAGE)
}
const DRY_RUN = !!pa.flags['--dry-run']
const VERIFY_ONLY = !!pa.flags['--verify']

const PROFILE = webProfileDir()
const TARGET = path.join(PROFILE, 'node_modules', PKG_NAME)
const PKG_MAP = path.join(PROFILE, 'node_modules', '.package-map.json')
const PATCH = path.join(PROFILE, 'cordis.patch.yml')
const PROFILE_PKG = path.join(PROFILE, 'package.json')

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const ARCHIVE = process.env.DSH_ARCHIVE_DIR || path.join(os.homedir(), 'DSH-archive')
const BACKUP = path.join(ARCHIVE, `host-adapter-client-deploy-${stamp}`)

const log = (m) => console.log(m)
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** 只读比对：实体 vs 源码（--verify）。 */
function verifyTarget() {
  log(`[源]   ${SRC}`)
  log(`[实体] ${TARGET}`)
  const rows = []
  for (const [from, to] of DEPLOY_FILES) {
    const srcFile = path.join(SRC, from)
    const tgtFile = path.join(TARGET, to)
    const srcSha = fs.existsSync(srcFile) ? sha256(srcFile) : null
    const tgtSha = fs.existsSync(tgtFile) ? sha256(tgtFile) : null
    rows.push({ name: from, srcSha, tgtSha, ok: srcSha !== null && srcSha === tgtSha })
  }
  for (const r of rows) {
    log(
      `  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(24)} 源 ${r.srcSha ? r.srcSha.slice(0, 16) : '(缺失)'}` +
        `  实体 ${r.tgtSha ? r.tgtSha.slice(0, 16) : '(缺失)'}`,
    )
  }
  const bad = rows.filter((r) => !r.ok)
  if (bad.length) {
    console.error(`[不一致] ${bad.length}/${rows.length} 个文件与源码不符：${bad.map((r) => r.name).join(', ')}`)
    console.error('[提示] 跑 node deploy.mjs 部署，实体即与源码一致')
    return 1
  }
  log(`[一致] ${rows.length}/${rows.length} 个文件与源码逐字节一致`)
  return 0
}

async function main() {
  log('[源] ' + SRC + '（自包含：源码与部署脚本同目录）')

  // 0 前置 fail-closed：源文件必须齐
  const missing = DEPLOY_FILES.map(([from]) => from).filter((from) => !fs.existsSync(path.join(SRC, from)))
  if (missing.length) {
    console.error('[中止] 源码目录缺文件：' + missing.join('、'))
    console.error('       缺失生成产物请先跑：node sync-client-host-adapter.mjs')
    return 2
  }
  // 0.1 语法守卫
  for (const file of CHECK_FILES) {
    const res = spawnSync(process.execPath, ['--check', path.join(SRC, file)], { encoding: 'utf8' })
    if (res.status !== 0) {
      console.error(`[中止] 语法检查失败 ${file}：` + String(res.stderr || '').split('\n').slice(0, 3).join(' / '))
      return 2
    }
  }
  log(`[前置] 源文件齐备（${DEPLOY_FILES.length} 件）+ 语法检查通过（${CHECK_FILES.length} 件）`)

  // 门禁①（零写副作用）：lib/ 逃逸相对 import
  {
    const esc = findEscapingImports(path.join(SRC, 'lib'), { root: SRC })
    log(`[门禁①] 静态扫 lib/：${esc.scanned} 文件 / ${esc.specs} 处相对 import`)
    if (esc.bad.length) {
      for (const b of esc.bad) console.error(`  ✗ ${b.file}:${b.line}  '${b.spec}' → ${b.resolved}`)
      console.error('[中止] 门禁①未通过 —— 未写任何文件')
      return 1
    }
    log('  ✓ 无逃逸相对 import')
  }

  // 门禁②（零写副作用）：产物 ↔ 唯一源同源
  {
    const loaded = await loadSource()
    if (loaded.error) {
      console.error('[中止] 门禁②无法执行：' + loaded.error)
      return 1
    }
    const plan = planOf(loaded)
    let bad = 0
    for (const item of plan) {
      const cur = fs.existsSync(item.file) ? fs.readFileSync(item.file, 'utf8') : null
      const ok = cur === item.text
      if (!ok) bad++
      log(`  ${ok ? '✓' : '✗'} ${path.basename(item.file)} ↔ 唯一源 v${loaded.version}（sha ${loaded.sha.slice(0, 16)}…）`)
    }
    log(`[门禁②] 生成产物 ↔ 唯一源（${plan.length} 件）：${bad ? '❌ ' + bad + ' 件不符' : '同源 ✅'}`)
    if (bad) {
      console.error('[中止] 门禁②未通过 —— 未写任何文件（跑 node sync-client-host-adapter.mjs 重新生成）')
      return 1
    }
  }

  if (VERIFY_ONLY) return verifyTarget()

  if (!fs.existsSync(PROFILE)) {
    console.error('[中止] profile 目录不存在：' + PROFILE)
    console.error('       用环境变量 DSH_HOME 指定（隔离测试环境见 dsh-test-env 技能）。')
    return 2
  }
  log('[目标] profile = ' + PROFILE)

  if (DRY_RUN) {
    log('[模式] dry-run：只打印将要做的改动，不写任何文件')
    log('[计划] 备份 → 复制 ' + DEPLOY_FILES.map(([from]) => from).join(' / ') + ' → package-map → patch insert → sha256 自校验')
    return 0
  }

  const problems = []

  // 1) 备份
  fs.mkdirSync(BACKUP, { recursive: true })
  for (const [label, file] of [['package.json', PROFILE_PKG], ['.package-map.json', PKG_MAP], ['cordis.patch.yml', PATCH]]) {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, path.join(BACKUP, label))
      log(`[备份] ${label} → ${BACKUP}`)
    }
  }
  if (fs.existsSync(TARGET)) {
    fs.cpSync(TARGET, path.join(BACKUP, `node_modules-${PKG_NAME}`), { recursive: true })
    log('[备份] 既有实体目录 → ' + path.join(BACKUP, `node_modules-${PKG_NAME}`))
  }

  // 2) 复制实体
  fs.mkdirSync(path.join(TARGET, 'lib'), { recursive: true })
  for (const [from, to] of DEPLOY_FILES) {
    const src = path.join(SRC, from)
    const dst = path.join(TARGET, to)
    fs.copyFileSync(src, dst)
    log(`[复制] ${from} → ${dst} (${fs.statSync(dst).size} B)`)
  }

  // 2.5 fail-closed：实体 sha256 必须逐文件等于源码
  for (const [from, to] of DEPLOY_FILES) {
    const srcSha = sha256(path.join(SRC, from))
    const tgtSha = sha256(path.join(TARGET, to))
    if (srcSha === tgtSha) log(`[自校验] ${from} ✅ ${srcSha.slice(0, 16)}`)
    else {
      problems.push(`实体与源码不一致：${to}（源 ${srcSha.slice(0, 16)} ≠ 实体 ${tgtSha.slice(0, 16)}）`)
      console.error(`[自校验] ${from} ❌ 源 ${srcSha.slice(0, 16)} ≠ 实体 ${tgtSha.slice(0, 16)}`)
    }
  }

  // 3) package-map
  const map = JSON.parse(fs.readFileSync(PKG_MAP, 'utf8'))
  map.packages = map.packages ?? {}
  if (map.packages[PKG_NAME] === undefined) {
    map.packages[PKG_NAME] = { url: './' + PKG_NAME, dependencies: {} }
    fs.writeFileSync(PKG_MAP, JSON.stringify(map, null, 2) + '\n', 'utf8')
    log('[package-map] 已添加 ' + PKG_NAME)
  } else {
    log('[package-map] 已存在，跳过')
  }

  // 4) cordis.patch.yml
  let patchText = fs.readFileSync(PATCH, 'utf8')
  if (patchText.includes(`id: ${PLUGIN_ID}`)) {
    log('[cordis.patch] 已存在 insert，跳过')
  } else {
    const block = [
      '',
      '# dsh-host-adapter-client（2026-09-25 装 · adapter P3「客户端适配层包」）：',
      '# 客户端 bundle 是 window.__ModuleLoader__ 的 CJS 形态、由宿主按 exports["./client"] **单文件**',
      '# serve ⇒ 引用不到各包 lib/host-adapter.js 副本。本包把 SVC/EV 两张常量表以「client 面」暴露给',
      '# 浏览器模块表（exports["./client"] → lib/host-adapter.js，文件名即 R4 白名单命中条件），',
      '# 其它 bundle 用 require("@kira905/dsh-host-adapter-client") 取常量，替掉裸服务名/事件名字面量。',
      '# host 半是**空插件**（零 inject / 零副作用）：它存在的唯一理由是把客户端面放进 boot graph。',
      '# 不进 bundles（client 插件进 bundles 会崩 declares no dsh.bundle）。',
      '- insert:',
      `    - id: ${JSON.stringify(PLUGIN_ID)}`,
      `      name: '${PKG_NAME}'`,
      '',
    ].join('\n')
    fs.writeFileSync(PATCH, patchText.replace(/\s*$/, '\n') + block, 'utf8')
    log('[cordis.patch] 已追加 insert ' + PLUGIN_ID)
  }

  // 5) 校验（JSON / insert id 计数）
  JSON.parse(fs.readFileSync(PKG_MAP, 'utf8'))
  JSON.parse(fs.readFileSync(PROFILE_PKG, 'utf8'))
  log('[校验] package-map.json / profile package.json JSON 合法')
  const ids = [...fs.readFileSync(PATCH, 'utf8').matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((m) => m[1])
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  log(`[校验] cordis.patch.yml 文本扫出 entry 行 ${ids.length} 个；重复 id：${dup.length ? dup.join(',') : '无'}`)
  if (dup.length) problems.push('存在重复 insert id：' + dup.join(','))
  if (!ids.includes(PLUGIN_ID)) problems.push('未找到 ' + PLUGIN_ID + ' insert')

  if (problems.length) {
    console.error('')
    console.error('[失败] ' + problems.join('；'))
    console.error('[提示] 实体可能已被写坏，回滚点：' + BACKUP)
    return 1
  }
  log('[完成] 备份目录：' + BACKUP)
  return 0
}

process.exitCode = await main()
