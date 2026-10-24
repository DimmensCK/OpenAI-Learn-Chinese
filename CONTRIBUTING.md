# Contributing / 参与维护

[中文首页](README.md) · [English home](README.en.md)

## 提交问题

勘误请给出文章标题、官方 URL、相关原句、译文问题及建议修改。区分“旧快照已经过时”和“当时译文有误”。不要把官方现在的页面冒充 2026-10-21 的原始快照。

界面问题请附浏览器版本、视口尺寸、复现步骤及期望结果。先遮住截图中的个人信息。请勿提交阅读记录、API Key、令牌、账号导出或机器路径。

## 修改与验证

1. Fork 后创建分支，一次聚焦一个问题。阅读器使用原生 HTML/CSS/JavaScript，没有 npm 依赖或构建步骤。
2. 修改界面后，在浏览器中打开 `学习资料/index.html`，核对桌面和窄屏、深浅主题，以及受影响的搜索/文章/词汇/阅读记录操作。维护时可自选本地静态服务器；普通读者不需要它。
3. 使用 Node.js 22 或更新版本运行 `node scripts/validate.mjs`。结构检查不验证译文含义，也不代表所有浏览器都通过测试。
4. 内容正文位于 `学习资料/pages/` 和 `学习资料/glossary/`，搜索文本和来源信息位于 `学习资料/catalog.js`。更正内容时同步索引；保留来源与原稿状态，不覆盖旧来源 hash 假装来自新抓取。
5. 在 PR 中说明原因、来源、修改范围及真实检查结果。如果新增内容改变快照规模，明确更新校验基线和版本说明，不静默改变 322/325 的统计口径。

本仓库提供已经整理好的阅读包与阅读器源码，不包含原始采集和 AI 翻译流水线。贡献第三方原文、图片或译文之前，核对适用权利并保留来源。[许可范围](LICENSE.md)与[来源声明](NOTICE.md)适用于贡献。

## English

For a correction, include the article title, official URL, relevant source sentence, current translation and proposed wording. Separate a translation error from an upstream change since the snapshot date.

For a UI bug, include browser/version, viewport, reproduction steps and expected behavior. Remove private information from captures. Do not submit reading records, keys, tokens, account exports or machine-specific paths.

The reader is plain HTML/CSS/JavaScript with no npm dependencies or build step. Open `学习资料/index.html` in a browser, check the affected interactions, themes and narrow layout, then run `node scripts/validate.mjs` with Node.js 22 or later. The validator does not evaluate translation quality or certify browser compatibility.

Keep payloads in `学习资料/pages/` and `学习资料/glossary/` consistent with search text in `学习资料/catalog.js`. Preserve provenance and inherited review states. Do not replace source hashes with new values that falsely imply a fresh upstream capture. Changes to snapshot size need an explicit baseline and documentation update.

This repository contains the prepared reading package and reader source, not the original collection or AI translation pipeline. Check third-party rights and preserve attribution before contributing content. Explain what changed, why, and how you checked it in the pull request.
