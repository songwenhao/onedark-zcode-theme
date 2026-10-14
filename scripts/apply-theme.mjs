#!/usr/bin/env node
/**
 * onedark-zcode-theme — 把 One Dark Pro 主题层应用到 ZCode Desktop。
 *
 * 原理：解包 resources/app.asar，在内置样式表
 * out/renderer/assets/styles-*.css 末尾追加（或替换之前的）带标记注释的
 * onedark.css 覆盖层，重新打包并替换 app.asar。内置浅色主题与原生规则
 * 零改动；选择"深色"主题即为 One Dark Pro 外观。
 *
 * 用法：
 *   node scripts/apply-theme.mjs             应用主题（需关闭 ZCode，写
 *                                            Program Files 需管理员权限）
 *   node scripts/apply-theme.mjs --dry-run   只解包、打补丁并暂存到
 *                                            build/app.asar，不安装
 *   node scripts/apply-theme.mjs --restore   还原 backup/ 下最新的官方
 *                                            原版备份（.orig，经内容校验
 *                                            不含主题层）
 *
 * 备份命名：app.asar.orig-<时间戳> 只记录官方原版（首次应用或应用升级后的
 * 官方包时写入）；app.asar.prev-<时间戳> 是对已打补丁的包重复应用时的
 * 上一版存档，还原时永远不会选中。
 *
 * 可用 --asar <路径> 指定其他 app.asar（默认取当前平台的安装位置）。
 * 重复执行是幂等的：已有的主题层会先被剥掉再追加最新版本。
 * ZCode 升级会还原官方 app.asar，届时重新执行本脚本即可。
 */
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(scriptDir, '..')

const MARKER_START = '/*! onedark-zcode-theme:start */'
const MARKER_END = '/*! onedark-zcode-theme:end */'
const MARKER_RE =
  /\/\*! onedark-zcode-theme:start \*\/[\s\S]*?\/\*! onedark-zcode-theme:end \*\//

const DEFAULT_ASAR =
  process.platform === 'win32'
    ? 'C:\\Program Files\\ZCode\\resources\\app.asar'
    : process.platform === 'darwin'
      ? '/Applications/ZCode.app/Contents/Resources/app.asar'
      : '/opt/ZCode/resources/app.asar'

const BACKUP_KEEP = 3

function parseArgs(argv) {
  const opts = { restore: false, dryRun: false, asar: DEFAULT_ASAR, css: join(pkgRoot, 'onedark.css') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--restore') opts.restore = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--asar') opts.asar = argv[++i]
    else if (a === '--css') opts.css = argv[++i]
    else {
      console.error(`未知参数：${a}`)
      process.exit(2)
    }
  }
  return opts
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 在解包树里找到承载主题变量的内置样式表。 */
function findThemeStylesheet(buildDir) {
  const assetsDir = join(buildDir, 'out', 'renderer', 'assets')
  if (!existsSync(assetsDir)) {
    throw new Error('解包结果缺少 out/renderer/assets，app.asar 结构不符合预期')
  }
  let fallback = null
  for (const file of readdirSync(assetsDir).sort()) {
    if (!file.endsWith('.css')) continue
    const full = join(assetsDir, file)
    const text = readFileSync(full, 'utf8')
    if (text.includes('--theme-zai-dark') && text.includes('--color-background')) return full
    if (text.includes('--color-background')) fallback = full
  }
  if (!fallback) throw new Error('未找到内置主题样式表（styles-*.css）')
  return fallback
}

/** 从 asar 头里收集带 unpacked 标记的路径（含目录），用于前后一致性校验。 */
function collectUnpacked(asarMod, archive) {
  const SEP = process.platform === 'win32' ? '\\' : '/'
  const { header } = asarMod.getRawHeader(archive)
  const out = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = prefix + SEP + name
      if (child.unpacked) out.push(p)
      if (child.files) walk(child, p)
    }
  }
  walk(header, '')
  return out.sort()
}

async function buildPatchedAsar(asarMod, opts, stagedAsar) {
  const buildDir = join(pkgRoot, 'build', 'app')
  rmSync(join(pkgRoot, 'build'), { recursive: true, force: true })
  mkdirSync(buildDir, { recursive: true })

  console.log(`解包 ${opts.asar} ...`)
  asarMod.extractAll(opts.asar, buildDir)

  const unpackedBefore = collectUnpacked(asarMod, opts.asar)

  const stylesheet = findThemeStylesheet(buildDir)
  const relName = stylesheet.slice(buildDir.length + 1)
  console.log(`内置样式表：${relName}`)

  let css = readFileSync(stylesheet, 'utf8')
  css = css.replace(MARKER_RE, '').trimEnd()
  if (css.includes('onedark-zcode-theme')) {
    throw new Error('样式表中存在疑似残留的主题层标记，请手动检查')
  }
  const theme = readFileSync(opts.css, 'utf8').trim()
  if (!theme.includes('.theme-zai-dark')) {
    throw new Error(`主题文件 ${opts.css} 内容不符合预期（缺少 .theme-zai-dark 规则）`)
  }
  css += `\n\n${MARKER_START}\n${theme}\n${MARKER_END}\n`
  // 保持 UTF-8 无 BOM（该文件本就是无 BOM 的 ASCII/UTF-8）。
  writeFileSync(stylesheet, css, 'utf8')
  console.log(`已追加主题层（${theme.length} 字节）`)

  console.log('重新打包 app.asar ...')
  // 复刻原包的 unpack 策略：二进制文件（.node/.dll/.exe）不打入 asar，
  // node-pty 预编译目录整体标记 unpacked。asar 内置的 minimatch 3.x 无法
  // 用斜杠 glob 匹配 Windows 反斜杠路径，因此用字面前缀匹配；末尾补一个
  // 路径分隔符，避免 prebuilds 目录本身也被标记（原包未标记它）。
  // 打包后会逐项比对原包与重打包的 unpacked 集合，不一致即中止。
  await asarMod.createPackageWithOptions(buildDir, stagedAsar, {
    unpack: '{**/*.node,**/*.dll,**/*.exe}',
    unpackDir: join('node_modules', 'node-pty', 'prebuilds') + sep,
  })

  const unpackedAfter = collectUnpacked(asarMod, stagedAsar)
  if (JSON.stringify(unpackedBefore) !== JSON.stringify(unpackedAfter)) {
    console.error('原包 unpacked 数：', unpackedBefore.length)
    console.error('重打包 unpacked 数：', unpackedAfter.length)
    throw new Error('重打包后的 unpacked 标记与原包不一致，中止安装')
  }

  const listing = asarMod.listPackage(stagedAsar).map((p) => String(p).replace(/^[\\/]+/, ''))
  const relNorm = relName.split(/[\\/]/)
  if (!listing.includes(relNorm.join('\\')) && !listing.includes(relNorm.join('/'))) {
    throw new Error(`打包结果缺少 ${relName}，中止安装`)
  }
  const relBackslash = relNorm.join('\\')
  const repacked = Buffer.from(asarMod.extractFile(stagedAsar, relBackslash)).toString('utf8')
  if (!repacked.includes(MARKER_START)) {
    throw new Error('打包结果校验失败：主题层标记缺失，中止安装')
  }
  console.log(`打包校验通过（unpacked ${unpackedAfter.length} 项一致）：${stagedAsar}`)
  console.log(`  sha256 = ${sha256(stagedAsar)}`)
}

/** 检测 asar 内是否含主题层标记（区分官方原版与打过补丁的包）。 */
function hasThemeLayer(asarMod, archive) {
  const entries = asarMod.listPackage(archive).map((p) => String(p).replace(/^[\\/]+/, ''))
  for (const entry of entries) {
    if (!/^out[\\/]renderer[\\/]assets[\\/]styles-.*\.css$/.test(entry)) continue
    let text
    try {
      text = Buffer.from(asarMod.extractFile(archive, entry)).toString('utf8')
    } catch {
      const swapped = entry.split('\\').join('/')
      try {
        text = Buffer.from(asarMod.extractFile(archive, swapped)).toString('utf8')
      } catch {
        continue
      }
    }
    if (text.includes('onedark-zcode-theme')) return true
  }
  return false
}

/** 按前缀列出备份，按时间戳升序。 */
function listBackups(backupDir, prefix = 'app.asar.orig-') {
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter((f) => f.startsWith(prefix))
    .map((f) => join(backupDir, f))
    .sort()
}

function install(opts, stagedAsar, asarMod) {
  const backupDir = join(pkgRoot, 'backup')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  // 只在当前包是官方原版（无主题层）时写 .orig 备份；对打过补丁的包重复
  // apply 时写 .prev 备份，避免还原时误选到补丁版本。
  const pristine = !hasThemeLayer(asarMod, opts.asar)
  const prefix = pristine ? 'app.asar.orig-' : 'app.asar.prev-'
  const backupPath = join(backupDir, `${prefix}${stamp}`)
  try {
    copyFileSync(opts.asar, backupPath)
    copyFileSync(stagedAsar, opts.asar)
  } catch (err) {
    rmSync(backupPath, { force: true })
    console.error('安装失败：', err.message)
    console.error('请确认：')
    console.error('  1. ZCode 已完全退出（包括系统托盘图标）；')
    console.error('  2. 使用管理员身份运行终端后再执行（写入 Program Files 需要权限）。')
    process.exit(1)
  }
  for (const old of listBackups(backupDir, 'app.asar.orig-').slice(0, -BACKUP_KEEP)) {
    rmSync(old, { force: true })
  }
  for (const old of listBackups(backupDir, 'app.asar.prev-').slice(0, -2)) {
    rmSync(old, { force: true })
  }
  if (pristine) {
    console.log(`已备份官方原版：${backupPath}`)
  } else {
    console.log(`已备份上一版（当前包已含主题层，.orig 原版备份保持不变）：${backupPath}`)
  }
  console.log(`  sha256 = ${sha256(backupPath)}`)
  console.log('已安装 One Dark Pro 主题层，请重启 ZCode 并在设置中选择"深色"主题。')
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const asarModule = await import('@electron/asar')
  const asarMod = asarModule.default ?? asarModule

  if (opts.restore) {
    // 只认 .orig 前缀且经内容校验无主题层的备份；.prev 是补丁版本间的
    // 存档，还原不能用它。
    const candidates = listBackups(join(pkgRoot, 'backup'), 'app.asar.orig-')
      .filter((b) => !hasThemeLayer(asarMod, b))
    const newest = candidates.at(-1)
    if (!newest) {
      console.error('backup/ 下没有可用的官方原版备份（.orig 且无主题层）。')
      process.exit(1)
    }
    if (opts.dryRun) {
      console.log(`--dry-run：将还原 ${newest}（共 ${candidates.length} 个可用原版备份），未写入。`)
      return
    }
    try {
      copyFileSync(newest, opts.asar)
    } catch (err) {
      console.error('还原失败：', err.message)
      console.error('请先完全退出 ZCode，并以管理员身份运行。')
      process.exit(1)
    }
    console.log(`已从 ${newest} 还原官方 app.asar，请重启 ZCode。`)
    return
  }

  if (!existsSync(opts.asar)) {
    console.error(`未找到 ${opts.asar}，可用 --asar <路径> 指定 app.asar 位置。`)
    process.exit(1)
  }
  if (!existsSync(opts.css)) {
    console.error(`未找到主题文件 ${opts.css}。`)
    process.exit(1)
  }

  const stagedAsar = join(pkgRoot, 'build', 'app.asar.patched')
  await buildPatchedAsar(asarMod, opts, stagedAsar)

  if (opts.dryRun) {
    console.log('--dry-run：补丁已暂存，未写入安装目录。')
    return
  }
  console.log(`原版 sha256 = ${sha256(opts.asar)}`)
  install(opts, stagedAsar, asarMod)
}

main().catch((err) => {
  console.error(err?.stack || err)
  process.exit(1)
})
