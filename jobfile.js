const moment = require('moment')
const _ = require('lodash')
const turf = require('@turf/turf')
const makeDebug = require('debug')

const debug = makeDebug('k-vigicrues')

const dbUrl = process.env.DB_URL || 'mongodb://127.0.0.1:27017/vigicrues'
const ttl = +process.env.TTL || (7 * 24 * 60 * 60)  // duration in seconds

module.exports = {
  id: 'vigicrues',
  store: 'memory',
  options: {
    workersLimit: 1,
    faultTolerant: true
  },
  tasks: [{
    id: 'vigicrues',
    type: 'http',
    options: {
      url: 'https://www.vigicrues.gouv.fr/services/1/InfoVigiCru.geojson'
    }
  }],
  hooks: {
    tasks: {
      after: {
        readJson: {
        },
        generateStations: {
          hook: 'apply',
          function: (item) => {
            const features = _.get(item, 'data.features', [])
            _.forEach(features, feature => {
              // Ensure clean geometry as some multilinestrings have degenerated lines
              let nbInvalidGeometries = 0
              if (turf.getType(feature) === 'MultiLineString') {
                let lines = []
                turf.featureEach(turf.flatten(feature), line => {
                  try {
                    turf.cleanCoords(line, { mutate: true })
                    lines.push(turf.getCoords(line))
                  } catch (error) {
                    nbInvalidGeometries++
                  }
                })
                if (nbInvalidGeometries > 0) debug(`Filtering ${nbInvalidGeometries} invalid line(s) on ${feature.properties.LbEntCru}`)
                // Rebuild geometry from the clean line
                feature.geometry = turf.multiLineString(lines).geometry
              } else {
                turf.cleanCoords(feature, { mutate: true })
              }
              // Convert ID to numeric value
              _.set(feature, 'properties.gid', _.toNumber(feature.properties.gid))
              // Remove unused ID
              _.unset(feature, 'id')
              _.set(feature, 'properties.name', feature.properties.LbEntCru) // needed for timeseries
              _.set(feature, 'properties.NomEntVigiCru', feature.properties.LbEntCru) // backward compatibility
            })
          }
        },
        writeSections: {
          hook: 'updateMongoCollection',
          collection: 'vigicrues-sections',
          filter: { 'properties.gid': '<%= properties.gid %>' },
          upsert : true,
          transform: {
            pick: [
              'type',
              'geometry',
              'properties.gid',
              'properties.name',
              'properties.NomEntVigiCru',
              'properties.CdEntCru',
              'properties.CdTCC'
            ],
            inPlace: false
          },
          chunkSize: 256
        },
        generateForecasts: {
          hook: 'apply',
          function: (item) => {
            let forecastFeatures = []
            const features = _.get(item, 'data.features', [])
            _.forEach(features, feature => {
              let forecastFeature = turf.envelope(feature)
              _.set(forecastFeature, 'time', moment.utc().toDate())
              _.set(forecastFeature, 'properties.gid', feature.properties.gid) // needed for timeseries
              _.set(forecastFeature, 'properties.name', feature.properties.LbEntCru) // needed for timeseries
              _.set(forecastFeature, 'properties.NivSituVigiCruEnt', feature.properties.NivInfViCr) // needed for timeseries
              _.set(forecastFeature, 'properties.NomEntVigiCru', feature.properties.LbEntCru) // backward compatibility
              forecastFeatures.push(forecastFeature)
            })
            item.data = forecastFeatures
          }
        },
        writeForecasts: {
          hook: 'writeMongoCollection',
          collection: 'vigicrues-forecasts',
        },
        clearData: {}
      }
    },
    jobs: {
      before: {
        createStores: [{ id: 'memory' }],
        connectMongo: {
          url: dbUrl,
          // Required so that client is forwarded from job to tasks
          clientPath: 'taskTemplate.client'
        },
        createSectionsCollection: {
          hook: 'createMongoCollection',
          clientPath: 'taskTemplate.client',
          collection: 'vigicrues-sections',
          indices: [
            [{ 'properties.gid': 1 }, { unique: true }],
            { geometry: '2dsphere' }                                                                                                              
          ]
        },
        createForecastsCollection: {
          hook: 'createMongoCollection',
          clientPath: 'taskTemplate.client',
          collection: 'vigicrues-forecasts',
          indices: [
            [{ time: 1, 'properties.gid': 1 }, { unique: true }],
            { 'properties.NivSituVigiCruEnt': 1 },
            { 'properties.gid': 1, 'properties.NivSituVigiCruEnt': 1, time: -1 },
            [{ time: 1 }, { expireAfterSeconds: ttl }] // days in secs                                                                                                         
          ]
        }
      },
      after: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeStores: ['memory']
      },
      error: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeStores: ['memory']
      }
    }
  }
}
