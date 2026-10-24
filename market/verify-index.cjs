#!/usr/bin/env node
/**
 * Verify market/index.json against the DSH plugin market index format 1.
 *
 * Three layers:
 *   1. self-contained structural checks (no dependencies) — always run;
 *   2. git provenance (hard): every `git` source's commit must be a 40-hex SHA, exist
 *      locally, and be reachable from a remote ref — so the index never pins an
 *      unreachable commit (skip with --no-git-checks);
 *   3. the official validator `parseMarketIndex` from
 *      `@deepseek-ai/dsh-plugin-market-index`, run when an unpacked copy is found
 *      (env DSH_PLUGIN_MARKET_INDEX_DIR, else auto-detected under %TEMP%\dsh-compat).
 *
 * Usage:
 *   node market/verify-index.cjs                 # structural + git provenance + official when found
 *   node market/verify-index.cjs --require-official
 *   node market/verify-index.cjs --index <file>  # check another index document
 *   node market/verify-index.cjs --no-git-checks
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { execFileSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')

function argOf (name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const indexFile = argOf('--index') === undefined ? path.join(__dirname, 'index.json') : path.resolve(argOf('--index'))
/** Canonical URL the index is served from; used only for relative-icon resolution. */
const INDEX_URL = 'https://raw.githubusercontent.com/Shuffle-1992/dsh-browser-kit/main/market/index.json'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:(?:0|[1-9]\d*)|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/u
const COMMIT = /^[0-9a-f]{40}$/u
const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u
const MAX_PUBLISH_TIMESTAMP = 1e11

/** Members format 1 defines; anything else is dropped by the validator. */
const MEMBERS = {
  root: ['format', 'title', 'description', 'metadata', 'plugins'],
  metadata: ['categories', 'labels', 'sortKeys'],
  plugin: ['name', 'title', 'description', 'icon', 'author', 'homepage', 'repository', 'metadata', 'versions'],
  pluginMetadata: ['category', 'keywords', 'labels', 'sortKeys'],
  version: ['version', 'publishTimestamp', 'source', 'engines'],
  source: { npm: ['type', 'registry'], git: ['type', 'url', 'commit', 'path'] }
}

const failures = []
const warnings = []
function check (ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}
function warn (label, detail) {
  console.log(`WARN  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  warnings.push(label)
}

function isObject (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function nonEmptyString (value) {
  return typeof value === 'string' && value.trim() !== ''
}
function localizedHasEn (value) {
  if (nonEmptyString(value)) return true
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  if (!keys.every((key) => LANGUAGE_ID.test(key))) return false
  return Object.values(value).every(nonEmptyString) && nonEmptyString(value.en)
}
/** Report members present in the document that format 1 does not define (they are dropped). */
function unknownMembers (object, allowed) {
  return Object.keys(object).filter((key) => !allowed.includes(key))
}

function validateSource (source, at) {
  if (!isObject(source)) return `${at} must be an object`
  if (source.type === 'npm') {
    if (source.registry !== undefined) {
      try {
        const url = new URL(source.registry)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return `${at}.registry must use http or https`
        if (url.username !== '' || url.password !== '' || url.href.includes('?') || url.href.includes('#')) {
          return `${at}.registry must carry no credentials, query, or fragment`
        }
      } catch {
        return `${at}.registry must be an absolute URL`
      }
    }
    return undefined
  }
  if (source.type === 'git') {
    if (typeof source.url !== 'string') return `${at}.url must be a string`
    let url
    try {
      url = new URL(source.url)
    } catch {
      return `${at}.url must be an absolute URL`
    }
    if (url.protocol !== 'https:') return `${at}.url must use https:`
    if (url.href !== source.url) return `${at}.url must be canonical`
    if (url.username !== '' || url.password !== '' || url.href.includes('?') || url.href.includes('#')) {
      return `${at}.url must carry no credentials, query, or fragment`
    }
    if (!/^(?:\/[^/]+){2,}$/u.test(url.pathname)) return `${at}.url must name a repository with two path segments`
    if (!COMMIT.test(source.commit ?? '')) return `${at}.commit must be a lowercase 40-hex commit SHA`
    if (source.path !== undefined) {
      const bad = !nonEmptyString(source.path) || source.path.split('/').some((s) => s === '.' || s === '..' || !PATH_SEGMENT.test(s))
      if (bad) return `${at}.path must be a relative directory without . or ..`
    }
    return undefined
  }
  return `${at}.type must be "npm" or "git"`
}

function installSpecPreview (name, version) {
  const from = version.source
  if (from.type === 'npm') return `${name}@${version.version}`
  return `git+${from.url.endsWith('.git') ? from.url : `${from.url}.git`}#${from.commit}${from.path === undefined ? '' : `&path:/${from.path}`}`
}

/** Run git in the repository root; undefined when git is missing or the call fails. */
function git (args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return undefined
  }
}

/** True when the git command exits 0 (e.g. `cat-file -e`, `merge-base --is-ancestor`). */
function gitOk (args) {
  try {
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
}

/**
 * Tips of the remote's refs: `git ls-remote` first (authoritative), else the local
 * remote-tracking refs (staler, reported as such).
 */
function remoteTips (remoteName) {
  const out = git(['ls-remote', remoteName])
  if (out !== undefined && out !== '') {
    const refs = new Map()
    for (const line of out.split('\n')) {
      const [sha, ref] = line.trim().split(/\s+/u)
      if (sha !== undefined && ref !== undefined) refs.set(ref, sha)
    }
    if (refs.size > 0) return { refs, via: `git ls-remote ${remoteName}` }
  }
  const local = git(['for-each-ref', '--format=%(objectname) %(refname)', `refs/remotes/${remoteName}`])
  if (local !== undefined && local !== '') {
    const refs = new Map()
    for (const line of local.split('\n')) {
      const [sha, ref] = line.trim().split(/\s+/u)
      if (sha !== undefined && ref !== undefined) refs.set(ref, sha)
    }
    if (refs.size > 0) return { refs, via: `local ${remoteName} remote-tracking refs (ls-remote unavailable — weaker evidence)` }
  }
  return undefined
}

/** Auto-detect an unpacked official validator under %TEMP%\dsh-compat. */
function detectValidatorDir () {
  if (process.env.DSH_PLUGIN_MARKET_INDEX_DIR) return process.env.DSH_PLUGIN_MARKET_INDEX_DIR
  const root = path.join(os.tmpdir(), 'dsh-compat')
  if (!fs.existsSync(root)) return undefined
  const dirs = fs.readdirSync(root)
    .filter((entry) => entry.startsWith('dsh-plugin-market-index-'))
    .map((entry) => path.join(root, entry, 'package'))
    .filter((dir) => fs.existsSync(path.join(dir, 'lib', 'index.js')))
  if (dirs.length === 0) return undefined
  return dirs.sort().at(-1)
}

async function main () {
  console.log(`index:   ${path.relative(repoRoot, indexFile)}`)
  console.log(`schema:  plugin market index format 1 (@deepseek-ai/dsh-plugin-market-index)`)

  let text
  try {
    text = fs.readFileSync(indexFile, 'utf8')
  } catch (error) {
    check(false, 'index file is readable', error.message)
    return
  }
  let index
  try {
    index = JSON.parse(text)
    check(true, 'JSON parses')
  } catch (error) {
    check(false, 'JSON parses', error.message)
    return
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

  check(isObject(index), 'root is an object')
  check(index.format === 1, 'root.format is 1', String(index.format))
  check(localizedHasEn(index.title), 'root.title is LocalizedText containing en')
  if (index.description !== undefined) check(localizedHasEn(index.description), 'root.description is LocalizedText containing en')
  check(Array.isArray(index.plugins) && index.plugins.length > 0, 'root.plugins is a non-empty array', String(index.plugins?.length))

  const meta = index.metadata ?? {}
  check(isObject(meta), 'root.metadata is an object when present')
  const categories = meta.categories ?? {}
  const labels = meta.labels ?? {}
  const sortKeys = meta.sortKeys ?? {}
  for (const [group, declarations] of [['categories', categories], ['labels', labels], ['sortKeys', sortKeys]]) {
    check(isObject(declarations), `metadata.${group} is an object`)
    for (const [id, declaration] of Object.entries(declarations)) {
      const title = declaration?.title
      check(id !== '' && isObject(declaration) && localizedHasEn(title), `metadata.${group}.${id} declares a LocalizedText title`)
      if (group === 'sortKeys') check(declaration?.order === 'asc' || declaration?.order === 'desc', `metadata.sortKeys.${id}.order is asc|desc`)
    }
  }

  const names = new Set()
  index.plugins?.forEach((plugin, i) => {
    const at = `$.plugins[${i}]`
    check(isObject(plugin), `${at} is an object`)
    check(nonEmptyString(plugin.name) && plugin.name.length <= 214 && PACKAGE_NAME.test(plugin.name), `${at}.name is a valid npm package name`, plugin.name)
    check(!names.has(plugin.name), `${at}.name is unique`, plugin.name)
    names.add(plugin.name)
    for (const field of ['title', 'description']) {
      if (plugin[field] !== undefined) check(localizedHasEn(plugin[field]), `${at}.${field} is LocalizedText containing en`)
    }
    if (plugin.author !== undefined) check(nonEmptyString(plugin.author), `${at}.author is a non-empty string`)
    for (const field of ['homepage', 'icon']) {
      if (plugin[field] !== undefined) check(nonEmptyString(plugin[field]), `${at}.${field} is a non-empty string`)
    }
    if (plugin.repository !== undefined) {
      check(isObject(plugin.repository) && nonEmptyString(plugin.repository.url), `${at}.repository.url is a non-empty string`)
      if (typeof plugin.repository?.url === 'string') {
        const url = new URL(plugin.repository.url)
        check(
          (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === '' && !url.href.includes('?') && !url.href.includes('#'),
          `${at}.repository.url is an http(s) URL without credentials, query, or fragment`,
          plugin.repository.url
        )
      }
    }

    const pluginMeta = plugin.metadata ?? {}
    check(isObject(pluginMeta), `${at}.metadata is an object when present`)
    if (pluginMeta.category !== undefined) {
      check(Object.hasOwn(categories, pluginMeta.category), `${at}.metadata.category references a declared category`, pluginMeta.category)
    }
    const keywordList = pluginMeta.keywords ?? []
    check(Array.isArray(keywordList) && keywordList.every((keyword) => typeof keyword === 'string'), `${at}.metadata.keywords is an array of strings`)
    const labelList = pluginMeta.labels ?? []
    check(Array.isArray(labelList) && labelList.every((label) => typeof label === 'string'), `${at}.metadata.labels is an array of strings`)
    check(new Set(labelList).size === labelList.length, `${at}.metadata.labels has no duplicate`)
    for (const label of labelList) check(Object.hasOwn(labels, label), `${at}.metadata.labels references a declared label`, label)
    for (const key of Object.keys(pluginMeta.sortKeys ?? {})) {
      check(Object.hasOwn(sortKeys, key), `${at}.metadata.sortKeys references a declared sort key`, key)
      check(Number.isFinite(pluginMeta.sortKeys[key]), `${at}.metadata.sortKeys.${key} is a finite number`)
    }

    const versions = plugin.versions
    check(Array.isArray(versions) && versions.length > 0, `${at}.versions is a non-empty array`, String(versions?.length))
    const seen = new Set()
    versions?.forEach((version, j) => {
      const vAt = `${at}.versions[${j}]`
      check(isObject(version), `${vAt} is an object`)
      check(nonEmptyString(version.version) && SEMVER.test(version.version), `${vAt}.version is an exact SemVer`, version.version)
      check(!seen.has(version.version), `${vAt}.version is unique`, version.version)
      seen.add(version.version)
      const stamp = version.publishTimestamp
      check(
        typeof stamp === 'number' && Number.isInteger(stamp) && stamp >= 0 && stamp < MAX_PUBLISH_TIMESTAMP,
        `${vAt}.publishTimestamp is an integer in [0, 10^11)`, String(stamp)
      )
      const sourceError = validateSource(version.source, `${vAt}.source`)
      check(sourceError === undefined, `${vAt}.source is a valid npm|git source`, sourceError ?? JSON.stringify(version.source))
      if (version.engines !== undefined) {
        check(isObject(version.engines), `${vAt}.engines is an object`)
        if (version.engines?.dsh !== undefined) {
          const range = version.engines.dsh
          check(nonEmptyString(range) && !range.startsWith('workspace:'), `${vAt}.engines.dsh is not a workspace: range`, String(range))
          check(typeof range === 'string' && !/^\s*$/u.test(range), `${vAt}.engines.dsh is a non-empty range string (SemVer validity is the official validator's call)`, String(range))
          check(range === manifest.engines?.dsh, `${vAt}.engines.dsh equals package.json engines.dsh`, `${range} vs ${manifest.engines?.dsh}`)
        }
      }
    })
  })

  // Cross-checks against the release manifest.
  const first = index.plugins?.[0]
  check(first?.name === manifest.name, 'plugin name equals package.json name', `${first?.name} vs ${manifest.name}`)
  check(first?.versions?.[0]?.version === manifest.version, 'listed version equals package.json version', `${first?.versions?.[0]?.version} vs ${manifest.version}`)
  check(
    first?.repository?.url === (manifest.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, ''),
    'repository.url matches package.json repository',
    first?.repository?.url
  )

  // Format 1 has no license member: prove the license lives only in the manifest.
  const unknownRoot = unknownMembers(index, MEMBERS.root)
  const unknownPlugin = unknownMembers(first ?? {}, MEMBERS.plugin)
  const unknownVersion = unknownMembers(first?.versions?.[0] ?? {}, MEMBERS.version)
  check(unknownRoot.length === 0, 'root has no member format 1 drops', unknownRoot.join(', ') || 'none')
  check(unknownPlugin.length === 0, 'plugin has no member format 1 drops', unknownPlugin.join(', ') || 'none')
  check(unknownVersion.length === 0, 'version has no member format 1 drops', unknownVersion.join(', ') || 'none')
  warn('license is not a format-1 member', `declared only by package.json (license: ${manifest.license})`)

  for (const version of first?.versions ?? []) {
    console.log(`INFO  install spec: ${installSpecPreview(first.name, version)}`)
  }

  // Git provenance (hard): a pinned commit must exist and be pushed, or the entry is a
  // 404 for every user (dsh-plugin-market reports only `plugin-market/fetch-failed`).
  const gitSources = (index.plugins ?? []).flatMap((plugin) =>
    (plugin?.versions ?? [])
      .filter((version) => version?.source?.type === 'git')
      .map((version) => ({ plugin: plugin.name, version }))
  )
  if (process.argv.includes('--no-git-checks')) {
    warn('git provenance checks skipped', '--no-git-checks')
  } else if (gitSources.length === 0) {
    console.log('INFO  no git source in the index; git provenance checks not applicable')
  } else {
    const tips = remoteTips('origin')
    if (tips === undefined) {
      for (const { plugin, version } of gitSources) {
        check(false, `git provenance: ${plugin}@${version.version} commit is remote-reachable`, 'git ls-remote origin failed and no local remote-tracking refs exist')
      }
    } else {
      console.log(`INFO  remote tips via ${tips.via}`)
      for (const [ref, sha] of tips.refs) console.log(`INFO  remote tip ${ref} = ${sha}`)
      for (const { plugin, version } of gitSources) {
        const at = `${plugin}@${version.version}`
        const commit = version.source.commit
        check(COMMIT.test(commit ?? ''), `git provenance: ${at} commit is a lowercase 40-hex SHA`, String(commit))
        if (!COMMIT.test(commit ?? '')) continue
        check(gitOk(['cat-file', '-e', `${commit}^{commit}`]), `git provenance: ${at} commit exists in this repository`, commit)
        let reached
        for (const [ref, sha] of tips.refs) {
          if (sha === commit) {
            reached = `${ref} points at it`
            break
          }
          if (gitOk(['cat-file', '-e', `${sha}^{commit}`]) && gitOk(['merge-base', '--is-ancestor', commit, sha])) {
            reached = `${ref} contains it`
            break
          }
        }
        check(
          reached !== undefined,
          `git provenance: ${at} commit is reachable from a remote ref`,
          reached ?? `NOT reachable from any of ${[...tips.refs.keys()].join(', ')} — the index would install a 404`
        )
      }
    }
  }

  // Official validator, when an unpacked copy is available.
  const requireOfficial = process.argv.includes('--require-official')
  const dir = detectValidatorDir()
  if (dir === undefined) {
    const message = 'official validator not found; set DSH_PLUGIN_MARKET_INDEX_DIR to its unpacked package directory'
    if (requireOfficial) check(false, 'official parseMarketIndex ran', message)
    else warn('official parseMarketIndex skipped', message)
  } else {
    const entry = path.join(dir, 'lib', 'index.js')
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(entry)).digest('hex')
    try {
      const mod = await import(pathToFileURL(entry).href)
      const parsed = mod.parseMarketIndex(JSON.parse(text), INDEX_URL)
      check(true, 'official parseMarketIndex accepted the index', `${path.basename(path.dirname(dir))}/lib/index.js`)
      console.log(`INFO  validator sha256: ${sha256}`)
      console.log(`INFO  parsed: format=${parsed.format} title.en=${parsed.title.en} plugins=${parsed.plugins.length}`)
      console.log(`INFO  parsed declarations: categories=${Object.keys(parsed.metadata.categories).length} labels=${Object.keys(parsed.metadata.labels).length} sortKeys=${Object.keys(parsed.metadata.sortKeys).length}`)
      for (const plugin of parsed.plugins) {
        console.log(`INFO  parsed plugin: ${plugin.name} versions=${plugin.versions.map((v) => v.version).join(',')} category=${plugin.metadata.category ?? '-'} labels=${plugin.metadata.labels.join('|')}`)
        for (const version of plugin.versions) {
          const target = mod.marketInstallTarget(plugin.name, version)
          console.log(`INFO  official install target: spec=${target.spec}${target.registry === undefined ? '' : ` registry=${target.registry}`}`)
        }
      }
      check(parsed.plugins.length === index.plugins.length, 'official result keeps every plugin')
    } catch (error) {
      check(false, 'official parseMarketIndex accepted the index', `${error.name}: ${error.message}`)
    }
  }

  console.log(`\n${failures.length === 0 ? 'OK' : `FAILED (${failures.length})`}: checks=${failures.length === 0 ? 'all passed' : failures.join('; ')}${warnings.length === 0 ? '' : ` warnings=${warnings.length}`}`)
  if (failures.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`verify-index: ${error.message}`)
  process.exitCode = 1
})
