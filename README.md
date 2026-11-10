# Hadar IT · Frontend

Browser interface for [Hadar IT](https://github.com/MrFaviod/hadar-it): inventory,
people, locations, maintenance, monitoring and reporting.

Alpha software. Not ready for production. Requires the Hadar backend;
AI, monitoring and queued jobs need their corresponding configured services.

## Development

Node.js 22+, React 19, TypeScript and locally vendored Vue 3 domain views.
From this repository:

```bash
npm ci
npm run dev -- --port 5173
npm run check
```

Open <http://127.0.0.1:5173>. The development proxy targets the API on port 8000.
Server authorization and CSRF checks still apply.

## Documentation

- [Install Hadar](https://github.com/MrFaviod/hadar-it/blob/master/INSTALL.md)
- [Frontend development](https://github.com/MrFaviod/hadar-it/blob/master/docs/frontend/development.md)
- [Design system](https://github.com/MrFaviod/hadar-it/blob/master/docs/frontend/design.md)
- [Feature tour](https://github.com/MrFaviod/hadar-it/blob/master/docs/features.md)

Maintained guides live in the main repository. Local `docs/`, design notes and
agent instructions are internal and ignored.
[Report an issue](https://github.com/MrFaviod/hadar-it-frontend/issues).
