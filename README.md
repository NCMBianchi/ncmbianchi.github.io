# ncmbianchi.github.io

<!-- Badges -->
[![HTML5](https://img.shields.io/badge/uses-HTML5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/uses-CSS3-1572B6?logo=css&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![JavaScript](https://img.shields.io/badge/uses-JavaScript-F7DF1E?logo=javascript&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Rust](https://img.shields.io/badge/uses-Rust-black?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Bun](https://img.shields.io/badge/tested%20via-Bun-FFFDD0?logo=bun&logoColor=white)](https://bun.sh)

[![Deploy](https://img.shields.io/github/actions/workflow/status/NCMBianchi/ncmbianchi.github.io/deploy.yml?label=deploy)](https://github.com/NCMBianchi/ncmbianchi.github.io/actions)
[![Tests](https://img.shields.io/github/actions/workflow/status/NCMBianchi/ncmbianchi.github.io/test.yml?label=tests)](https://github.com/NCMBianchi/ncmbianchi.github.io/actions)
[![codecov](https://img.shields.io/codecov/c/github/NCMBianchi/ncmbianchi.github.io?logo=codecov&label=codecov)](https://codecov.io/gh/NCMBianchi/ncmbianchi.github.io)
[![License](https://img.shields.io/github/license/NCMBianchi/ncmbianchi.github.io)](LICENSE)

---

## Structure

```
.
├── public/                    everything GitHub Pages actually serves
│   ├── index.html               terminal-animation landing page — fixed header/prompt
│   │                             content, plus a live preview line per section fetched
│   │                             from ORCID, GitHub, and each page's own markup
│   │                             (js/home-preview.js)
│   ├── studies.html              fixed content — academic history
│   ├── publications.html         dynamic — ORCID Public API (js/publications.js)
│   ├── presentations.html        dynamic — ORCID Public API (js/presentations.js)
│   ├── repos.html                dynamic — GitHub REST + GraphQL APIs (js/repos.js,
│   │                             js/contrib-graph.js)
│   ├── skills.html               icon grid (simple-icons/Iconify) + a dynamic language
│   │                             breakdown bar fetched from assets/languages.json
│   │                             (js/skills-languages.js)
│   ├── interests.html            fixed content — tag list + cover images
│   ├── css/, js/                 styles, browser-side scripts
│   └── assets/, data/            images + generated JSON (contributions.json,
│                                 languages.json); data/ is gitignored deploy-time
│                                 fallback snapshots
├── tools/                     Rust binaries — data pipeline, not shipped to the browser
│   ├── contrib-graph/            fetches contribution activity and language breakdowns
│   │                             from GitHub (GraphQL), plus optional Gitea/GitLab
│   └── data-snapshot/            mirrors the client JS fetches, writes fallback JSON
├── tests/js/                  bun test suites for the pure logic in public/js/*.js
├── .github/workflows/         deploy, weekly contribution-graph refresh, tests + coverage
├── LICENSE
└── README.md
```

---

<sub>Visual inspiration by the [Charm](https://charm.sh) stack, [cowsay](https://github.com/tnalpgge/rank-amateur-cowsay) by Tony Monroe, and the [Afterglow theme](https://yabatadesign.github.io/afterglow-theme/) by YabataDesign:</sub>

<a href="https://github.com/charmbracelet/lipgloss"><img src="https://wsrv.nl/?url=https://github.com/user-attachments/assets/d13bbe1a-d2b2-4d18-9302-419a0bc3f579&trim=10&output=png" height="100"></a>
<a href="https://github.com/charmbracelet/gum"><img src="https://repository-images.githubusercontent.com/502193049/988f298e-d3fa-4337-9e46-0c54df302946" height="100"></a>
<a href="https://github.com/charmbracelet/glow"><img src="https://repository-images.githubusercontent.com/219616873/fe4a7a80-d35b-11ea-8d24-b5d2c931479a" height="100"></a>
