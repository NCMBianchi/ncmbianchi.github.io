# ncmbianchi.github.io

> Personal portfolio website for Niccolò Bianchi — bioinformatician, data analysis developer.

<!-- Badges will live here once CI/CD and tooling are wired up -->
<!-- e.g. GitHub Actions deploy status, Codecov coverage, language badges -->

---

## About

This is the source for [ncmbianchi.github.io](https://ncmbianchi.github.io), a static portfolio site built with plain HTML, CSS, and JavaScript (no framework).

---

## Structure

```
.
├── index.html          # Single-page portfolio
├── css/
│   └── style.css       # All styles, token-driven via CSS custom properties
├── js/
│   └── main.js         # Minimal progressive enhancement
├── assets/             # Images, CV PDF, etc. (not tracked in git for large files)
├── LICENSE
└── README.md
```

---

## Local development

No build step required — open `index.html` directly in a browser, or serve locally:

```bash
# Python (any machine with Python 3)
python3 -m http.server 8080

# Node (if you have npx)
npx serve .
```

---

## Customisation

All design tokens (colours, fonts, spacing) are CSS custom properties in `css/style.css` under `:root`. Swap them to restyle the entire site.

Content sections in `index.html`:

| Section | What to edit |
|---|---|
| **Hero** | Name, title, tagline, photo path, quick links |
| **About** | Bio paragraphs, skills snapshot |
| **Publications** | `<article class="pub-card">` blocks |
| **Presentations** | `<article class="pres-card">` blocks |
| **Projects** | `<article class="proj-card">` blocks |
| **Contact** | Email address, profile links |

---

## Deployment

The site is deployed automatically via GitHub Actions to GitHub Pages on push to `main`.

---

## License

[MIT](LICENSE) © 2024 Niccolò Bianchi
