# Publishing Branchy

Everything for the store listings: the texts and privacy answers ([listing.md](listing.md)), the images
([images/](images/)), and the script that makes the screenshots ([screens/](screens/)). The privacy policy is
[../PRIVACY.md](../PRIVACY.md).

## The package

`npm run pack` in the repo writes `dist/branchy-<browser>-<version>.zip` for `chrome`, `edge` and `opera`, from
`probe/` with each browser's manifest (`scripts/manifests.js`). Upload the zip of that browser. For an update: raise
`version` in `probe/manifest.json`, pack, upload.

## The stores

| | Chrome Web Store | Microsoft Edge Add-ons | Opera add-ons |
|---|---|---|---|
| Account | Google account (personal), 2-step verification, $5 once | Microsoft Partner Center (personal), free | addons.opera.com developer account, free |
| Upload | `dist/branchy-chrome-*.zip` | `dist/branchy-edge-*.zip` | `dist/branchy-opera-*.zip` |
| Images | screenshots 1–5, `promo-440x280.png` | screenshots 1–5, `logo-300.png` | screenshots 1–5 |
| Review | days; longer for the `tabs` permission and the optional access to any site | up to a week | by hand, can take weeks |

Accounts, contact addresses and anything shown publicly are personal, never a work identity (see CLAUDE.md).

## After the first publish

A copy installed from a store has an ID of its own, so it starts with empty storage. To move a tree to it: Settings ›
Backup › Export in the old copy, turn the old copy off, install the store's, Import. Two copies turned on at once
would both manage the tab groups.

## The screenshots

Made from the real extension in Chrome's real side panel, with made-up sample data served by local fake sites
(`screens/lib/sample.js`, `screens/lib/server.js`); the extension's own statuses watch reads them. Once:

```
npm install                 # in the repo: @resvg/resvg-js
cd store/screens
npm install                 # puppeteer (Chrome for Testing goes to ~/.cache/puppeteer), pngjs
./setup.sh                  # libgbm and libwayland-server into libs/, Segoe UI and Consolas from Windows into fonts/
```

Then `node make.js` (about 30 s) writes `images/` and a contact sheet, `screens/index.html`. `node make.js --only=2,3`
captures those shots again; `node make.js --compose` only lays them out again (headlines and layout are in
`compose.js`, the panel's size and each shot's steps in `capture.js`). The extension is copied from `probe/` at every
run, so the images follow the code. `libs/`, `fonts/` and the working files stay out of git; the fonts are Windows'
own and are not to be shared.
