# Gacha Movie Analysis

World Flipper character gacha animation is controlled by the response fields in `/latest/api/index.php/gacha/exec`:

- `draw[].movie_id`
- `draw[].seed`

Starpoint does not send the pinball coordinates directly. The current evidence indicates that coordinates/routes are selected client-side from the `movie_id + seed` pair.

## Current Starpoint Behavior

Relevant implementation:

- `src/lib/gacha.ts`
- `assets/gacha_movie_seeds.json`
- `assets/gacha_rate_up_movie_seeds.json`

Current flow:

1. `drawGachaSync()` chooses the final character result.
2. `rewardPlayerGachaDrawResultSync()` chooses a movie type:
   - `0`: normal movie
   - `1`: guarantee/upgraded movie
3. It selects a seed from one of the local seed JSON files.
4. The client receives the final result and plays an animation matching `movie_id` and `seed`.

The visual upgrade does not currently determine the actual reward. The reward is already decided server-side before the movie seed is chosen.

## Seed Pool Size

From the current asset JSON files:

### `assets/gacha_movie_seeds.json`

| Rarity | Movie Type | Count |
| --- | ---: | ---: |
| 3-star | normal | 292 |
| 4-star | normal | 124 |
| 4-star | guarantee | 44 |
| 5-star | normal | 23 |
| 5-star | guarantee | 7 |

### `assets/gacha_rate_up_movie_seeds.json`

| Rarity | Movie Type | Count |
| --- | ---: | ---: |
| 3-star | normal | 162 |
| 4-star | normal | 56 |
| 4-star | guarantee | 24 |
| 5-star | normal | 14 |
| 5-star | guarantee | 2 |

This explains why some high-rarity or fes/rate-up animations can feel repetitive, especially 5-star rate-up guarantee movies.

## Important Limitation

The seed files were generated from observed real `/gacha/exec` responses. See `scripts/extract_seeds.py`.

That means the current seed pool is not guaranteed to contain every valid client-side route. It only contains seeds observed in captured traffic. There may be many more valid seeds in the client or asset bundles.

## Safe Improvements

These can be done without reverse engineering the APK:

- Fix seed selection bias in `src/lib/gacha.ts`; current code uses `randomInt(0, seeds.length + 1)`, which can select an out-of-range index and fall back to `seeds[0]`.
- Add a development-only gacha movie log so every draw records `gacha_id`, rarity, `movie_id`, `seed`, and character result.
- Add a configurable movie policy for local testing:
  - preserve original rates
  - increase guarantee movie frequency
  - force guarantee movie for selected test draws
- Merge more observed seeds from additional mitmproxy flow captures using `scripts/extract_seeds.py`.

## Risky Improvements Requiring Evidence

These should not be enabled by default until tested:

- Sending random seed values outside the observed seed lists.
- Mixing normal and rate-up seed pools for all banners.
- Reusing a seed with a different `movie_id` than originally observed.
- Trying to invent coordinate paths server-side.

The client may reject unknown seeds, fall back to a default route, show broken animation, or crash.

## Recommended Experiment

When normal gameplay is stable:

1. Add a local-only debug option to override one draw's `seed`.
2. Test known valid seeds first.
3. Test nearby unknown seeds in the observed numeric range, for example `10000000` to `10011000`.
4. Record whether the client:
   - plays a unique route,
   - falls back to a default route,
   - shows no upgrade,
   - crashes or reports an error.
5. If arbitrary seeds work, expand Starpoint to generate seeds procedurally.
6. If arbitrary seeds do not work, continue collecting valid seeds from real captures or client asset analysis.

## Current Conclusion

Yes, animation variety can probably be improved, but the correct mechanism is seed pool expansion and movie policy tuning, not server-side coordinate generation.

The safest immediate code improvement is to fix the seed selection bias and add logging/debug controls. Large-scale route expansion needs evidence from seed experiments or APK/asset analysis.
