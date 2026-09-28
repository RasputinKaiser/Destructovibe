# Contributing

Use Node.js 22.18 or newer and install dependencies with `npm ci`.
Run `npm run dev` to develop locally. Before submitting a pull request, run:

```sh
npm run build
npm test
npm run validate:fractures
npm run validate:levels
npm run validate:grid
npm run validate:rigging
```

Include reproduction steps and the actual validation output for any failing check.
Keep generated output and dependencies out of commits. The `legacy/` directory
preserves the original Rapier version; current development lives in `src/`.

For visual or physics changes, describe the site, tool, and controls used to
exercise the change in a browser. Automated geometry checks do not replace playtesting.
