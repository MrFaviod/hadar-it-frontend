<img src="assets/svg/logo.svg" width="56" height="56" alt="">

# Hadar IT · Frontend

The browser application of [Hadar IT](https://github.com/MrFaviod/hadar-it): inventory, people, sites, maintenance, monitoring, reports and the assistant. A React 19 and TypeScript host renders the domain views, which are locally vendored Vue 3 components.

> **Alpha.** Not ready for production. To run the whole application, follow the [installation guide](https://github.com/MrFaviod/hadar-it/blob/master/INSTALL.md); this repository alone needs a running Hadar IT backend.

## Develop

Requires Node.js 22 or later. From this repository:

```bash
npm ci
npm run dev -- --port 5173
```

Open <http://127.0.0.1:5173>. The development server proxies `/api` to `http://127.0.0.1:8000`, or to `ITSM_DEV_API_URL` when set. Authorization and CSRF checks stay on the server, so you sign in with a real backend account.

## Check

```bash
npm run check
```

`check` runs the Node test suite, then the TypeScript check and the production build. Browser suites (`npm run test:browser`, `test:lifecycle`, `test:visual`) need Python with Playwright and Chromium.

## Documentation

Maintained guides live in the main repository:

- [Frontend development](https://github.com/MrFaviod/hadar-it/blob/master/docs/frontend/development.md)
- [Design](https://github.com/MrFaviod/hadar-it/blob/master/docs/frontend/design.md) and [brand](https://github.com/MrFaviod/hadar-it/blob/master/docs/frontend/brand.md)
- [Feature tour](https://github.com/MrFaviod/hadar-it/blob/master/docs/features.md)
- [All documentation](https://github.com/MrFaviod/hadar-it/blob/master/docs/README.md)

Local `docs/`, design notes and agent instructions in this repository are internal working files and are not published.

[Report an issue](https://github.com/MrFaviod/hadar-it-frontend/issues)
