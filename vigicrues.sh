#!/bin/bash
krawler --run --port 3030 --cron "0 0 0 */1 * *" jobfile-stations.js
krawler --port 3031 --cron "0 0 */1 * * *" jobfile-sections.js
krawler --port 3032 --cron "0 0 */1 * * *" jobfile-stations-data.js

