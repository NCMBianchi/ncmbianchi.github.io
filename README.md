# ncmbianchi.github.io

> Personal portfolio website for Niccolò Bianchi — bioinformatician, data analysis developer.

<!-- Badges -->
[![Deploy](https://img.shields.io/github/actions/workflow/status/NCMBianchi/ncmbianchi.github.io/deploy.yml?label=deploy)](https://github.com/NCMBianchi/ncmbianchi.github.io/actions)
[![Tests](https://img.shields.io/github/actions/workflow/status/NCMBianchi/ncmbianchi.github.io/test.yml?label=tests)](https://github.com/NCMBianchi/ncmbianchi.github.io/actions)
[![HTML5](https://img.shields.io/badge/uses-HTML5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/uses-CSS3-1572B6?logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![JavaScript](https://img.shields.io/badge/uses-JavaScript-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Rust](https://img.shields.io/badge/uses-Rust-black?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Bun](https://img.shields.io/badge/tested%20with-Bun-FFFDD0?logo=bun&logoColor=black)](https://bun.sh)
[![codecov](https://img.shields.io/codecov/c/github/NCMBianchi/ncmbianchi.github.io?logo=codecov&label=codecov)](https://codecov.io/gh/NCMBianchi/ncmbianchi.github.io)

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
│   ├── skills.html               fixed content — icon grid (simple-icons/Iconify)
│   ├── interests.html            fixed content — tag list + cover images
│   ├── css/, js/                 styles, browser-side scripts
│   └── assets/, data/            images; data/ is gitignored deploy-time fallback snapshots
├── tools/                     Rust binaries — data pipeline, not shipped to the browser
│   ├── contrib-graph/            fetches the GitHub contribution calendar (GraphQL)
│   └── data-snapshot/            mirrors the client JS fetches, writes fallback JSON
├── tests/js/                  bun test suites for the pure logic in public/js/*.js
├── .github/workflows/         deploy, daily contribution-graph refresh, tests + coverage
├── LICENSE
└── README.md
```

---

## License

[MIT](LICENSE) © 2026 Niccolò Bianchi

---

<sub>Visual inspiration by the [Charm](https://charm.sh) stack, [cowsay](https://github.com/tnalpgge/rank-amateur-cowsay) by Tony Monroe, and the YabataDesign [Afterglow theme](https://yabatadesign.github.io/afterglow-theme/):</sub>

<a href="https://github.com/charmbracelet/lipgloss"><img src="https://github.com/user-attachments/assets/d13bbe1a-d2b2-4d18-9302-419a0bc3f579" height="50"></a>
<a href="https://github.com/charmbracelet/gum"><img src="https://repository-images.githubusercontent.com/502193049/988f298e-d3fa-4337-9e46-0c54df302946" height="50"></a>
<a href="https://github.com/charmbracelet/glow"><img src="https://repository-images.githubusercontent.com/219616873/fe4a7a80-d35b-11ea-8d24-b5d2c931479a" height="50"></a>
