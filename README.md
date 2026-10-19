# Public MeteoSwiss mountain weather data

Public weather snapshots and a standalone OGD extraction utility. This repository contains no product source, user journeys, credentials or private account data.

## Source and attribution

Source: [MeteoSwiss Local forecast data](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-local-forecasting) and [automatic station metadata](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-smn). Original data attribution: MeteoSwiss, CC-BY-4.0. Files are transformed from Windows-1252 semicolon CSV into point JSON. Timestamps remain UTC. Low-cloud fraction is converted to percent; precipitation probability and weather symbols describe three-hour forecast intervals.

Cloudflare checks the complete forecast publication every five minutes and dispatches this GitHub Actions producer when an hourly update is due. GitHub only executes `workflow_dispatch`; its delayed built-in hourly schedule has been removed. Runner and official-source availability are still required. Consumers must rely on the actual official run and preprocessing time, not assume an update happened. They must expose stale data; this is a forecast cache, not a summit observation or an operator-status feed.

The newest run containing all six required parameters is selected. Any failed extraction leaves the previous complete snapshot in place. Only selected common high mountain points and their valley references have forecast files. The index includes other official high points for unambiguous place matching; an indexed point does not guarantee a forecast file. First uses the nearby Grindelwald / Oberläger1980m reference, not an invented First summit reading.

No raw nationwide CSV is committed. The working tree retains two forecast runs; older versions remain recoverable in Git history. No force push is used. Consumers request small per-point JSON files. Future forecasts extend only to the original official model horizon.

`node scripts/update-weather.mjs` performs the same source extraction locally without credentials. The workflow's built-in token writes only this data repository; no product-repository or Cloudflare token is used.

Nationwide forecast downloads use bounded byte-range batches and preserve CSV row boundaries. This reduces slow transfer stalls without changing values or moving parsing back to the product Worker. A complete six-parameter run is required before publication; no partial run replaces the previous snapshot.


## Cloudflare scheduling

The dedicated Cloudflare dispatcher checks `weather/status.json` every five
minutes. This tiny manifest is committed atomically with the complete point files;
its `run` and `generatedAt` keep their original meaning. An unchanged complete run
does not advance either timestamp. Workflow titles include `cloudflare` and a
`cf-...` request ID for audit and recovery. Manual dispatch remains available.
The old GitHub schedule was removed after the real Cloudflare cron at
2026-10-19 04:05:23 UTC dispatched successful run
[39197741085](https://github.com/kstd123/next-token-weather-data/actions/runs/39197741085),
which published official issue `202610190400` for 24 points.
No Cloudflare/GitHub credential is stored in this repo.

[Public scheduler status](https://next-token-weather-scheduler.897984507.workers.dev/status)
reports actual issue age, retries, queued/running jobs and alarms. Issues older than
90 minutes produce an explicit status alarm and Cloudflare error log. It does not
guarantee an hourly SLA; runner queues, upstream outages and CDN caches still apply.
