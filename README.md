# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Cloud9Gleam/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Cloud9Gleam/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it ranks 194 pre-token protocols by implied value — what a token would be worth if the protocol's record stayed as it is — and shows how to farm each one before or after it issues a token. Board snapshot 2026-11-20 (DefiLlama fetch 2026-11-20T05:54:27Z): 34 watchlist protocols at or above the $50M TVL floor plus the 160 highest-TVL pre-token protocols below it. The model scores TVL, 7-day growth and time running with no token; it never predicts whether or when a token is issued.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The entry reads the sealed snapshot at `../input/snapshot.json` (the kit's `input/`), writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, the dashboard to `out/dashboard/` and the judge dossier to `out/dossier.json`. Node 22.18 or later, standard library only.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
