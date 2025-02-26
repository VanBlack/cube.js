/* eslint-disable no-new */
/* globals describe,test,expect,jest,beforeAll */

const R = require('ramda');
const RefreshScheduler = require('./RefreshScheduler');
const CubejsServerCore = require('./index');
const CompilerApi = require('./CompilerApi');

const schemaContent = `
cube('Foo', {
  sql: 'select * from foo',
  
  measures: {
    count: {
      type: 'count'
    },
    
    total: {
      sql: 'amount',
      type: 'sum'
    },
  },
  
  dimensions: {
    time: {
      sql: 'timestamp',
      type: 'time'
    }
  },
  
  preAggregations: {
    first: {
      type: 'rollup',
      measureReferences: [count],
      timeDimensionReference: time,
      granularity: 'day',
      partitionGranularity: 'day',
      scheduledRefresh: true,
      refreshKey: {
        every: '1 hour',
        updateWindow: '1 day',
        incremental: true
      }
    },
    second: {
      type: 'rollup',
      measureReferences: [total],
      timeDimensionReference: time,
      granularity: 'day',
      partitionGranularity: 'day',
      scheduledRefresh: true,
      refreshKey: {
        every: '1 hour',
        updateWindow: '1 day',
        incremental: true
      }
    },
  }
});

cube('Bar', {
  sql: 'select * from bar',
  
  measures: {
    count: {
      type: 'count'
    }
  },
  
  dimensions: {
    time: {
      sql: 'timestamp',
      type: 'time'
    }
  },
  
  preAggregations: {
    first: {
      type: 'rollup',
      measureReferences: [count],
      timeDimensionReference: time,
      granularity: 'day',
      partitionGranularity: 'day',
      scheduledRefresh: true,
      refreshKey: {
        every: '1 hour',
        updateWindow: '1 day',
        incremental: true
      }
    }
  }
});
`;

const repository = {
  localPath: () => __dirname,
  dataSchemaFiles: () => Promise.resolve([
    { fileName: 'main.js', content: schemaContent },
  ]),
};

class OrchestratorApiMock {
  constructor() {
    this.createdTables = [];
  }

  async executeQuery(query) {
    console.log('Executing query', query);
    if (query.query && query.query.match(/min\(.*timestamp.*foo/)) {
      return {
        data: [{
          min: '2020-12-27T00:00:00.000',
        }],
      };
    } else if (query.query && query.query.match(/max\(.*timestamp.*/)) {
      return {
        data: [{
          max: '2020-12-31T00:00:00.000',
        }],
      };
    } else if (query.query && query.query.match(/min\(.*timestamp.*bar/)) {
      return {
        data: [{
          min: '2020-12-29T00:00:00.000',
        }],
      };
    } else if (query.query && query.query.match(/max\(.*timestamp.*bar/)) {
      return {
        data: [{
          max: '2020-12-31T00:00:00.000',
        }],
      };
    }

    if (query.preAggregations) {
      query.preAggregations.forEach(p => {
        const timezone = p.loadSql[0].match(/AT TIME ZONE '(.*?)'/)[1];
        if (!this.createdTables.find(t => t.tableName === p.tableName && t.timezone === timezone)) {
          this.createdTables.push({ tableName: p.tableName, timezone });
          // eslint-disable-next-line no-throw-literal
          throw { error: 'Continue wait' };
        }
      });
    }

    return {
      data: [],
    };
  }
}

describe('Refresh Scheduler', () => {
  const setupScheduler = () => {
    const serverCore = new CubejsServerCore({
      dbType: 'postgres',
      apiSecret: 'foo',
    });
    const compilerApi = new CompilerApi(repository, 'postgres', {
      compileContext: {},
      logger: (msg, params) => {
        console.log(msg, params);
      },
    });
    const orchestratorApi = new OrchestratorApiMock();
    jest.spyOn(serverCore, 'getCompilerApi').mockImplementation(() => compilerApi);
    jest.spyOn(serverCore, 'getOrchestratorApi').mockImplementation(() => orchestratorApi);
    const refreshScheduler = new RefreshScheduler(serverCore);
    return { refreshScheduler, orchestratorApi };
  };

  test('Round robin pre-aggregation refresh by history priority', async () => {
    const { refreshScheduler, orchestratorApi } = setupScheduler();
    const result = [
      { tableName: 'stb_pre_aggregations.foo_first20201231', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201231', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.bar_first20201231', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_first20201230', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201230', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.bar_first20201230', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_first20201229', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201229', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.bar_first20201229', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_first20201228', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201228', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_first20201227', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201227', timezone: 'UTC' },
    ];
    for (let i = 0; i < 1000; i++) {
      const refreshResult = await refreshScheduler.runScheduledRefresh(null, { concurrency: 2, workerIndices: [0] });
      expect(orchestratorApi.createdTables).toEqual(R.take((i + 1) * 2, result).filter((x, qi) => qi % 2 === 0));
      if (refreshResult.finished) {
        break;
      }
    }

    for (let i = 0; i < 1000; i++) {
      const refreshResult = await refreshScheduler.runScheduledRefresh(null, { concurrency: 2, workerIndices: [1] });
      const prevWorkerResult = result.filter((x, qi) => qi % 2 === 0);
      expect(orchestratorApi.createdTables).toEqual(
        prevWorkerResult.concat(R.take((i + 1) * 2, result).filter((x, qi) => qi % 2 === 1))
      );
      if (refreshResult.finished) {
        break;
      }
    }
  });

  test('Round robin pre-aggregation with timezones', async () => {
    const { refreshScheduler, orchestratorApi } = setupScheduler();
    const result = [
      { tableName: 'stb_pre_aggregations.foo_first20201231', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201231', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.bar_first20201231', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_first20201231', timezone: 'America/Los_Angeles' },
      { tableName: 'stb_pre_aggregations.foo_second20201231', timezone: 'America/Los_Angeles' },
      { tableName: 'stb_pre_aggregations.bar_first20201231', timezone: 'America/Los_Angeles' },

      { tableName: 'stb_pre_aggregations.foo_first20201230', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201230', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.bar_first20201230', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_first20201230', timezone: 'America/Los_Angeles' },
      { tableName: 'stb_pre_aggregations.foo_second20201230', timezone: 'America/Los_Angeles' },
      { tableName: 'stb_pre_aggregations.bar_first20201230', timezone: 'America/Los_Angeles' },

      { tableName: 'stb_pre_aggregations.foo_first20201229', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201229', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.bar_first20201229', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_first20201229', timezone: 'America/Los_Angeles' },
      { tableName: 'stb_pre_aggregations.foo_second20201229', timezone: 'America/Los_Angeles' },
      { tableName: 'stb_pre_aggregations.bar_first20201229', timezone: 'America/Los_Angeles' },

      { tableName: 'stb_pre_aggregations.foo_first20201228', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201228', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_first20201228', timezone: 'America/Los_Angeles' },
      { tableName: 'stb_pre_aggregations.foo_second20201228', timezone: 'America/Los_Angeles' },

      { tableName: 'stb_pre_aggregations.foo_first20201227', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_second20201227', timezone: 'UTC' },
      { tableName: 'stb_pre_aggregations.foo_first20201227', timezone: 'America/Los_Angeles' },
      { tableName: 'stb_pre_aggregations.foo_second20201227', timezone: 'America/Los_Angeles' },
    ];
    for (let i = 0; i < 1000; i++) {
      const refreshResult = await refreshScheduler.runScheduledRefresh(
        null,
        { concurrency: 2, workerIndices: [0], timezones: ['UTC', 'America/Los_Angeles'] }
      );
      expect(orchestratorApi.createdTables).toEqual(R.take((i + 1) * 2, result).filter((x, qi) => qi % 2 === 0));
      if (refreshResult.finished) {
        break;
      }
    }

    for (let i = 0; i < 1000; i++) {
      const refreshResult = await refreshScheduler.runScheduledRefresh(
        null,
        { concurrency: 2, workerIndices: [1], timezones: ['UTC', 'America/Los_Angeles'] }
      );
      const prevWorkerResult = result.filter((x, qi) => qi % 2 === 0);
      expect(orchestratorApi.createdTables).toEqual(
        prevWorkerResult.concat(R.take((i + 1) * 2, result).filter((x, qi) => qi % 2 === 1))
      );
      if (refreshResult.finished) {
        break;
      }
    }
  });
});
