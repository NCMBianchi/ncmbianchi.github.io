# ncmbianchi.github.io

> Personal portfolio website for Niccolò Bianchi — bioinformatician, data analysis developer.

<!-- Badges -->
[![Deploy](https://img.shields.io/github/actions/workflow/status/NCMBianchi/ncmbianchi.github.io/deploy.yml?style=flat-square&label=deploy)](https://github.com/NCMBianchi/ncmbianchi.github.io/actions)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Bun](https://img.shields.io/badge/Bun-black?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![Rust](https://img.shields.io/badge/Rust-black?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![codecov](https://img.shields.io/codecov/c/github/NCMBianchi/ncmbianchi.github.io?style=flat-square)](https://codecov.io/gh/NCMBianchi/ncmbianchi.github.io)

---

## About

Static portfolio site for [ncmbianchi.github.io](https://ncmbianchi.github.io), built with plain HTML, CSS, and vanilla JavaScript — no framework, no build step.

The landing page features a terminal animation styled after the owner's own fish shell prompt (`⋊≡°>`) and the [Afterglow](https://github.com/YabataDesign/afterglow-theme) colour theme. The animated TUI runs a mock `myself -h` command cycling through six sections.

---

## Structure

```
.
├── index.html              # Landing page with terminal animation
├── about.html              # Academic studies
├── publications.html       # Publications (ORCID)
├── presentations.html      # Presentations (Zenodo)
├── repos.html              # Repos / contributions
├── skills.html             # Skills
├── interests.html          # Interests
├── css/
│   └── style.css           # All styles — tokens in :root, Afterglow terminal palette
├── js/
│   └── main.js             # Terminal animation, skip logic, nav behaviour
├── assets/                 # Photo, CV PDF (not tracked — see .gitignore)
├── LICENSE
└── README.md
```

---

## Local development

No install needed:

```bash
# Preferred (Bun)
bun --hot ./index.html

# Fallback
python3 -m http.server 8080
```

---

## Design notes

| Property | Value |
|---|---|
| Primary font | JetBrains Mono (Google Fonts) |
| Terminal palette | [Afterglow](https://github.com/YabataDesign/afterglow-theme) by YabataDesign |
| Prompt character | `⋊≡°>` (from [keep_the_fish_alive](https://github.com/NCMBianchi/keep_the_fish_alive)) |
| Accent | Pastel lavender `#9b8bf4` (light) / `#b5a7f7` (dark) |
| Themes | Light default + auto dark via `prefers-color-scheme` |

CLI/TUI aesthetic references: [Lipgloss](https://github.com/charmbracelet/lipgloss) · [Gum](https://github.com/charmbracelet/gum) · [Glow](https://github.com/charmbracelet/glow) · [Bubble Tea](https://github.com/charmbracelet/bubbletea)

---

## Deployment

Deployed automatically via GitHub Actions to GitHub Pages on push to `main`.

---

## License

[MIT](LICENSE) © 2026 Niccolò Bianchi
