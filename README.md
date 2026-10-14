# Public MeteoSwiss mountain weather data

Public weather snapshots and a standalone OGD extraction utility. This repository contains no product source, user journeys, credentials or private account data.

## Source and attribution

Source: [MeteoSwiss Local forecast data](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-local-forecasting) and [automatic station metadata](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-smn). Original data attribution: MeteoSwiss, CC-BY-4.0. Files are transformed from Windows-1252 semicolon CSV into point JSON. Timestamps remain UTC. Low-cloud fraction is converted to percent; precipitation probability and weather symbols describe three-hour forecast intervals.

A GitHub Actions job is configured to run hourly at minute17. Runner availability is required; consumers must rely on the recorded run and preprocessing time, not assume that an update happened. Scheduling can be delayed. Each index records the official run and preprocessing time. Consumers must expose stale data; this is a forecast cache, not a summit observation or an operator-status feed.

The newest run containing all six required parameters is selected. Any failed extraction leaves the previous complete snapshot in place. Only selected common high mountain points and their valley references have forecast files. The index includes other official high points for unambiguous place matching; an indexed point does not guarantee a forecast file. First uses the nearby Grindelwald / Oberläger1980m reference, not an invented First summit reading.

No raw nationwide CSV is committed. The working tree retains two forecast runs; older versions remain recoverable in Git history. No force push is used. Consumers request small per-point JSON files. Future forecasts extend only to the original official model horizon.

`node scripts/update-weather.mjs` performs the same source extraction locally without credentials. The workflow's built-in token writes only this data repository; no product-repository or Cloudflare token is used.

Nationwide forecast downloads use bounded byte-range batches and preserve CSV row boundaries. This reduces slow transfer stalls without changing values or moving parsing back to the product Worker. A complete six-parameter run is required before publication; no partial run replaces the previous snapshot.
