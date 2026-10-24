[简体中文](README.md) · **English**

# OpenAI Learn in Chinese

### Read in Chinese. Keep the English source close.

An unofficial Chinese learning library for OpenAI Learn, with **322 articles**, their English snapshots, and **325 glossary entries**. Read online or download the complete folder and open it in your browser. Search, chapter navigation and reading progress help you work through the material at your own pace.

**[Read online ↗](https://learn-chinese-v6.dimmensck.chatgpt.site)** · **[Download the complete library](https://github.com/DimmensCK/OpenAI-Learn-Chinese/releases/latest)** · [Get started](#start) · [Features](#features)

Unofficial · AI-assisted translations · Content snapshot: **2026-10-21** · Downloadable reader: **V6**

[![Library checks](https://github.com/DimmensCK/OpenAI-Learn-Chinese/actions/workflows/validate.yml/badge.svg?branch=main)](https://github.com/DimmensCK/OpenAI-Learn-Chinese/actions/workflows/validate.yml)

![Actual V6 downloadable reader home page, with Learn categories, search, and article and glossary counts](docs/assets/offline-home.jpg)

> This is a personal project, not an official OpenAI translation or an endorsed product. The translations have not received independent human review article by article. Check current official sources for pricing, access and product behavior. [Sources and rights](NOTICE.md)

<a id="features"></a>

## A reading space for Chinese-speaking learners

| When you want to… | The library provides… |
|---|---|
| Work through a tutorial | Topic navigation, chapters for long articles, retained code and prompts |
| Check a translation | Chinese and English snapshot views for each article, plus official source links |
| Look up a term | Search across articles and a 325-entry glossary with concise explanations |
| Pick up where you left off | Read/unread marks, status filters, JSON progress export and import |
| Read comfortably | Light and dark themes, a narrow-screen layout, and offline access to saved content |

The reader uses plain HTML, CSS and JavaScript. Reading requires no account, API key, backend or package installation. Article bodies load on demand.

Press **Ctrl K** (**⌘ K** on Mac) to search titles, text or English terms. Open an article, switch between Chinese and its saved English version, choose a chapter and mark it as read. The browser's Ctrl F searches the currently displayed chapter; use the reader's search for other articles.

![Actual V6 downloadable glossary in dark mode, with explanations and category filters](docs/assets/offline-glossary-dark.jpg)

### Read on a phone

The hosted reader is convenient on mobile. These are real captures of **hosted V6.3** at a phone-sized browser viewport. The downloadable **V6** also has a narrow-screen layout, with different navigation details.

<p align="center">
  <img src="docs/assets/online-mobile-article.jpg" width="260" alt="Hosted V6.3 in a narrow light-mode viewport: an excerpt from the prompt-design article">
  &nbsp;&nbsp;
  <img src="docs/assets/online-mobile-docs-dark.jpg" width="260" alt="Hosted V6.3 in a narrow dark-mode viewport: document navigation and reading-status filters">
</p>

[Screenshot sources and versions](docs/assets/MEDIA.md)

<a id="start"></a>

## Get started in three steps

1. Open [Releases](https://github.com/DimmensCK/OpenAI-Learn-Chinese/releases/latest) and download **Source code (zip)** under **Assets**. It contains the complete library and reader.
2. **Extract the entire ZIP** into a normal folder. Keep `开始学习.cmd` beside the `学习资料` folder.
3. On Windows, double-click **开始学习.cmd**. On macOS or Linux, or if you prefer to skip the launcher, open **学习资料/index.html** in your browser.

You do not need Node.js, Python, an extension or a local server to read. Do not run the files from inside the ZIP. Use a recent Chrome, Edge or Firefox. Local-file support on phones varies by operating system and browser; the hosted version is the recommended mobile entry point.

**Code → Download ZIP** also downloads the current source, which opens the same way after extraction. A Release ZIP is a fixed version; the source ZIP follows the current main branch.

### Hosted or downloaded?

| | Hosted version | Downloadable version |
|---|---|---|
| Start | [Open the site](https://learn-chinese-v6.dimmensck.chatgpt.site) | Download and extract |
| Reader version | V6.3 | V6 |
| Connection | Requires internet access; availability varies by network | Saved articles, glossary, search and reading marks work offline |
| Content | 2026-10-21 Learn snapshot | Same snapshot date; 322 articles and 325 terms |
| Progress | Local to the browser and site | Local to the browser and file location |
| Moving between devices | Export JSON and import on the other device | Same; no automatic cloud sync |

External sites, videos, downloads, interactive demos and some system speech voices need a connection. The offline package keeps English snapshots and media links, not every external media file.

## What's included

| Material | Scope |
|---|---|
| Chinese articles with English snapshots | **322**, sourced from `learn.chatgpt.com` |
| Glossary | **325 entries**, with existing reference links |
| Unavailable source entries | **9**, clearly marked and excluded from the 322 article count |
| Snapshot date | **2026-10-21**; no automatic upstream synchronization |
| Inherited translation states | 279 drafts and 43 reviewed entries; these labels do not mean professional human review |

Topics include ChatGPT, Codex, prompting and workflows covered by Learn. This release contains the **Learn library only**, not the separate Developers article collection. Some glossary references point to Developers.

The interface is primarily Chinese. This English README does not imply a fully English interface; the saved article bodies can be viewed in English. Source URLs and hashes preserve traceability, not a guarantee of translation accuracy. The bundled [usage guide](学习资料/使用说明.md) and [source notes](学习资料/来源与权利说明.md) contain more detail in Chinese.

## Keep a copy of your progress

Use the reading-progress page to export a JSON backup before switching browser, device, folder or version. Import it at the new location; imports merge records.

Progress stays in browser storage and is not uploaded to a server. Clearing browser data, private browsing or storage restrictions may remove it or prevent persistence. Hosted and local addresses have separate storage and do not sync automatically.

## Troubleshooting

<details>
<summary>The page is blank or says the library could not load.</summary>

Extract the entire package. `index.html`, `catalog.js`, `app.js`, `app.css`, `pages/` and `glossary/` must remain together inside `学习资料`. A single downloaded HTML file is insufficient. Enable JavaScript and try a recent browser.

</details>

<details>
<summary>Is this official, current, or fully human-reviewed?</summary>

No. It is an unofficial, AI-assisted snapshot with no OpenAI endorsement. Compare uncertain wording, numbers or instructions with the English snapshot and current official source. Specific corrections are welcome.

</details>

<details>
<summary>Can I customize the reader or redistribute the material?</summary>

You can download the reader source. The project's own reader code is available under MIT within the scope in [LICENSE.md](LICENSE.md). Original documents, translations, glossary content and third-party material in screenshots are excluded from that grant. Check applicable rights before redistributing content or adding new material.

</details>

## Contribute

For a translation correction, open an [issue](https://github.com/DimmensCK/OpenAI-Learn-Chinese/issues) with the article title, official URL, relevant sentence and suggested wording. For a UI bug, include your browser, viewport and reproduction steps. Remove private information from screenshots. Focused pull requests are welcome.

For maintenance, run the structural validator with Node.js 22 or later:

```sh
node scripts/validate.mjs
```

It checks the package structure, counts, payloads and sources, not translation quality. [Contributing guide](CONTRIBUTING.md).

```text
开始学习.cmd              Windows launcher
学习资料/
  index.html              Browser entry point
  app.js / app.css        Reader behavior and styles
  catalog.js              Catalog and search index
  pages/                  322 bilingual article payloads
  glossary/               325 glossary payloads
docs/assets/              Screenshots and media notes
scripts/validate.mjs      Package validation
```

## Sources and licensing

Thanks to [OpenAI Learn](https://learn.chatgpt.com) for the original learning resources. This library is organized and maintained by [DimmensCK](https://github.com/DimmensCK). Product names and trademarks belong to their respective owners.

**Reader code and learning content have different rights.** The project's own reader code is available under [MIT](LICENSE-CODE). Source documents, translations, glossary entries and third-party material retain their respective rights. No explicit authorization covering public redistribution of the entire mirrored and translated collection has been confirmed. Public availability and AI-assisted translation do not establish an open-content license. See [NOTICE.md](NOTICE.md) for scope and rights inquiries.

Planned work includes translation corrections, reading improvements and a separately maintained Developers library. Releases will record what actually ships. If the library is useful, a Star makes it easier to find again; specific issues help improve it.
