# quarry

mine rocks, fill your pack, sell at the depot, buy a better pickaxe, pay open the
gate, dig deeper. three zones, five ores, no fail state.

- free. no ads, no purchases, no accounts.
- works offline once loaded (it's a pwa, add it to the home screen).
- one thumb to play: drag to walk, everything else happens by standing near it.
- your save can hop devices with a QR code from the pickaxe button.

all art is drawn in code (canvas vectors), the logo included.

## develop

```bash
npm ci
npm run dev      # local dev server
npm test         # engine tests
npm run check    # typecheck + tests + build, the merge gate
npm run test:e2e # loop, camera, and offline browser checks
node tools/make-icons.mjs  # re-rasterize the svg logo to png icons
```

MIT.
