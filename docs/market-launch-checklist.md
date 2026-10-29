# 发布到 DSH Plugin Hub（市场）清单

> 发版前逐项打勾。索引格式与构建脚本见 [`market-index.md`](./market-index.md)。

---


| 要求 | 本仓库状态 |
|---|---|
| **公开 GitHub 仓库** | ✅ <https://github.com/Shuffle-1992/dsh-browser-kit>（公开） |
| **Topic `dsh-plugin`** | ✅ 已设置（另加 `dsh`、`cordis`） |
| **Topic `deepseek-harness`**（Cordis 插件） | ✅ 已设置 |
| **README 含安装命令** | ✅ 见上文 `dsh plugin --profile web add …` |
| **package.json 元数据** | ✅ `name` / `version` / `description` / `repository` / `keywords` |
| **`dsh.bundle.patch`**（Bundle 分发） | ✅ `plugin/cordis.patch.yml` |

**添加 Topics（两种方式）**

1. 网页：仓库主页 → About 右侧齿轮 ⚙ → Topics 填 `dsh-plugin`、`deepseek-harness` → Save；
2. 命令行（需已登录 `gh` 或提供 token）：
   ```bash
   gh api -X PUT repos/Shuffle-1992/dsh-browser-kit/topics \
     -f names[]=dsh-plugin -f names[]=deepseek-harness -f names[]=cordis
   ```
