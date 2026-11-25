# thruhike-weather

A small daily job for the game Thru-Hike. Once a day it fetches a nine-day forecast for each of the game's eight regions and writes `forecast.json`. The game downloads that one file when a phone is online and uses it to set how likely rain is and how warm the day is. Offline, the game falls back to its built-in monthly averages.

Weather data from [MET Norway](https://api.met.no/), licensed under CC BY 4.0 and NLOD 2.0.

## Live migrations

A second daily job (`fetch-migrations.mjs`, `migrations.yml`) writes `migrations.json`: for each region, up to two walkable animals that nature watchers reported far more often than usual near the game's trails in the last 14 days. Counts come from research-grade observations on [iNaturalist](https://www.inaturalist.org/). `roster.json` is made by the game (`npm run migration:roster`); `taxa.json` keeps iNaturalist taxon ids between runs.
