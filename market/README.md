# market/ — DSH 插件市场索引（format 1）

本目录发布 `dsh-browser-kit` 的 **DSH 插件市场索引**（plugin market index，format 1），供 DSH Web GUI 的 **Plugins → Discover** 页与 `plugin_market` 工具读取。

| 文件 | 作用 |
|---|---|
| `index.json` | 索引本体（format 1），**由脚本生成**，不要手改 |
| `build-index.cjs` | 生成器：从根 `package.json` 读包事实 + 本文件内的显示文案，产出 `index.json`。默认 **git 源**，commit 优先取远端 `origin refs/heads/main`（已推送），取不到才回退本地 HEAD，并打印取值来源 |
| `verify-index.cjs` | 校验器：自包含结构检查 + **git 溯源硬断言**（commit 40-hex / 本地存在 / 远端可达）+（若可用）官方 `parseMarketIndex` |

## 用法

```bash
node market/build-index.cjs                            # 默认：git 源 + 远端 main 的 commit
node market/build-index.cjs --commit <40hex>            # 显式钉住某个 commit
node market/build-index.cjs --source npm                # 等 npm 发布后再切（详见 docs §2.1）
node market/verify-index.cjs --require-official         # 校验（官方校验器必跑）
node market/verify-index.cjs --index <file>             # 校验任意索引文档（坏样本回归）
node market/verify-index.cjs --no-git-checks            # 无 git 环境时跳过远端可达性断言
```

> 索引钉的是**已推送**的提交：远端不可达的 commit 会让 `verify-index.cjs` 以 exit 1 失败（防"用户侧 404"）。

## 在 DSH 里使用

1. 打开 **Plugins**，在 **Experimental plugins** 旁的 **More** 里开启 **Custom plugin markets**（0.2.1 起；随附 profile 默认关闭）。
2. 进入 **Discover** → **Add index source**，填入本索引的 http(s) URL（无重定向、无需签名）：
   `https://raw.githubusercontent.com/Shuffle-1992/dsh-browser-kit/main/market/index.json`
3. 安装走 git：`git+https://github.com/Shuffle-1992/dsh-browser-kit.git#<索引钉的 commit>`，**不需要** npm 发布。

格式规则、证据（`包@版本 文件:行号`）与未确认项见 [`docs/market-index.md`](../docs/market-index.md)。
