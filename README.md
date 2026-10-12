# thruhike-weather

A small daily job for the game Thru-Hike. Once a day it fetches a nine-day forecast for each of the game's eight regions and writes `forecast.json`. The game downloads that one file when a phone is online and uses it to set how likely rain is and how warm the day is. Offline, the game falls back to its built-in monthly averages.

Weather data from [MET Norway](https://api.met.no/), licensed under CC BY 4.0 and NLOD 2.0.
