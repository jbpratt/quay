# Images page assets

Served by `AssetHandler` under `/images/assets/`. Everything the page loads is
in this directory and embedded in the binary; the page makes no other request.

| File | Source |
| --- | --- |
| `images.css` | `@patternfly/patternfly` 6.4.0, subset by `subset.py` (below) |
| `fonts/RedHatTextVF.woff2`, `fonts/RedHatDisplayVF.woff2`, `fonts/RedHatMonoVF.woff2` | `@patternfly/patternfly` 6.4.0 `assets/fonts/`, upright faces only |
| `RH_Logo_Quay_Black_UX-horizontal.svg`, `RH_Logo_Quay_White_UX-horizontal.svg` | `static/img/` in this repository |
| `images.js`, `theme.js` | written for this page |

Icons are inline SVG symbols in `../page.html`, with paths from
`@patternfly/react-icons` 6.4.0 (`angle-down`, `copy`, `search`, `times`,
`cubes`), so neither icon font is shipped.

## Regenerating `images.css`

From the repository root, after changing the classes the page or its scripts use:

```sh
I=internal/mirrorregistry/images
mkdir -p /tmp/pf && (cd /tmp/pf && npm pack @patternfly/patternfly@6.4.0 && tar -xzf patternfly-patternfly-6.4.0.tgz)
P=/tmp/pf/package
python3 -I $I/assets/subset.py $P/patternfly.css $I/page.html $I/assets/images.js $I/assets/theme.js > $I/assets/images.css
cp $P/assets/fonts/RedHatText/RedHatTextVF.woff2 $P/assets/fonts/RedHatDisplay/RedHatDisplayVF.woff2 $P/assets/fonts/RedHatMono/RedHatMonoVF.woff2 $I/assets/fonts/
```

`subset.py` keeps a rule only when every class one of its selectors requires
appears in the page or its scripts, then drops custom properties no kept
declaration reaches. Its input is the whole `patternfly.css`, so kept rules
stay in PatternFly's cascade order. A class added only at runtime must appear literally in
`images.js` or `theme.js` to survive. PurgeCSS 5-7 was tried first and drops
PatternFly rules it should keep (`:is(...):first-child`, `:where(:not(...))`).
