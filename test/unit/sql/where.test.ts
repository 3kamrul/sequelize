import util from 'util';
import type { WhereOptions, ModelAttributeColumnOptions, Utils, WhereOperators, InferAttributes, Attributes } from '@sequelize/core';
import { DataTypes, QueryTypes, Op, literal, col, where, fn, json, cast, and, or, Model } from '@sequelize/core';
import { expectTypeOf } from 'expect-type';
import attempt from 'lodash/attempt';
// eslint-disable-next-line import/order -- issue with mixing require & import
import { createTester } from '../../support2';

const support = require('../support');

const { sequelize, expectsql } = support;

const sql = sequelize.dialect.queryGenerator;

// Notice: [] will be replaced by dialect specific tick/quote character
// when there is no dialect specific expectation but only a default expectation

// TODO:
//  - fix and resolve any .skip test
//  - don't disable test suites if the dialect doesn't support. Instead, ensure dialect throws an error if these operators are used.

// TODO
//  - test Op.overlap on [date, date] where the value is not an array
//  - test Op.overlap for ranges should not be more than 2 items
//  - test Op.overlap with ANY & VALUES:
//      ANY (VALUES (ARRAY[1]), (ARRAY[2])) is valid
//      ANY (ARRAY[ARRAY[1,2]]) is not valid
//  - range operators

// TODO:
//  - test binding values
// TODO: Test OR, AND
// TODO: Test nested OR & AND
// TODO: check auto-cast happens for attributes referenced using $nested.syntax$
// TODO: check syntax $nested.attr$::cast, $nested.attr$.json.path, $nested.attr$.json.path::cast

type Options = {
  type?: QueryTypes,
  prefix?: string | Utils.Literal,
  field?: ModelAttributeColumnOptions,
};

type Expectations = {
  [dialectName: string]: string | Error,
};

const dialectSupportsArray = () => sequelize.dialect.supports.ARRAY;
const dialectSupportsRange = () => sequelize.dialect.supports.RANGE;

class TestModel extends Model<InferAttributes<TestModel>> {
  declare intAttr1: number;
  declare intAttr2: number;

  declare nullableIntAttr: number | null;

  declare intArrayAttr: number[];

  declare stringAttr: string;
  declare dateAttr: Date;
  declare booleanAttr: boolean;

  declare jsonAttr: object;
  declare jsonbAttr: object;

  declare aliasedInt: number;
  declare aliasedJsonAttr: object;
  declare aliasedJsonbAttr: object;
}

type TestModelWhere = WhereOptions<Attributes<TestModel>>;

TestModel.init({
  intAttr1: DataTypes.INTEGER,
  intAttr2: DataTypes.INTEGER,
  nullableIntAttr: DataTypes.INTEGER,

  intArrayAttr: DataTypes.ARRAY(DataTypes.INTEGER),

  stringAttr: DataTypes.STRING,
  dateAttr: DataTypes.DATE,
  booleanAttr: DataTypes.BOOLEAN,

  jsonAttr: { type: DataTypes.JSON },
  jsonbAttr: { type: DataTypes.JSONB },

  aliasedInt: { type: DataTypes.INTEGER, field: 'aliased_int' },
  aliasedJsonAttr: { type: DataTypes.JSON, field: 'aliased_json' },
  aliasedJsonbAttr: { type: DataTypes.JSONB, field: 'aliased_jsonb' },
}, { sequelize });

describe(support.getTestDialectTeaser('SQL'), () => {
  describe('whereQuery', () => {
    it('prefixes its output with WHERE when it is not empty', () => {
      expectsql(
        sql.whereQuery({ firstName: 'abc' }),
        {
          default: `WHERE [firstName] = 'abc'`,
          mssql: `WHERE [firstName] = N'abc'`,
        },
      );
    });

    it('returns an empty string if the input results in an empty query', () => {
      expectsql(
        sql.whereQuery({ firstName: { [Op.notIn]: [] } }),
        {
          default: '',
        },
      );
    });
  });

  describe('whereItemsQuery', () => {

    type IncludesType<Haystack, Needle> = Needle extends any
      ? Extract<Haystack, Needle> extends never ? false : true
      : never;

    /**
     * 'OperatorsSupportingSequelizeValueMethods' lists all operators
     * that accept values: `col()`, `literal()`, `fn()`, `cast()`, and { [Op.col] }
     */
    type OperatorsSupportingSequelizeValueMethods = keyof {
      [Key in keyof WhereOperators<number>
        as IncludesType<
          WhereOperators<number>[Key],
          Utils.Col | Utils.Literal | Utils.Fn | Utils.Cast | { [Op.col]: string }
        > extends true ? Key : never
      ]: WhereOperators<number>[Key]
    };

    /**
     * Tests whether an operator is compatible with the 5 sequelize methods that can be used as values:
     * - col()
     * - literal()
     * - fn()
     * - cast()
     * - legacy Op.col
     *
     * If there is a typescript error on the operator passed to this function, then
     * the typings in {@link WhereOperators} for the provided operator are incorrect.
     *
     * @param operator
     * @param sqlOperator
     */
    function testSequelizeValueMethods(
      operator: OperatorsSupportingSequelizeValueMethods,
      sqlOperator: string,
    ): void {
      testSql({ intAttr1: { [operator]: { [Op.col]: 'intAttr2' } } }, {
        default: `[intAttr1] ${sqlOperator} [intAttr2]`,
      });

      testSql({ intAttr1: { [operator]: col('intAttr2') } }, {
        default: `[intAttr1] ${sqlOperator} [intAttr2]`,
      });

      testSql({ intAttr1: { [operator]: literal('literal') } }, {
        default: `[intAttr1] ${sqlOperator} literal`,
      });

      testSql({ intAttr1: { [operator]: fn('NOW') } }, {
        default: `[intAttr1] ${sqlOperator} NOW()`,
      });

      testSql({ intAttr1: { [operator]: cast(col('intAttr2'), 'string') } }, {
        default: `[intAttr1] ${sqlOperator} CAST([intAttr2] AS STRING)`,
      });

      testSql({ intAttr1: { [operator]: cast(12, 'string') } }, {
        default: `[intAttr1] ${sqlOperator} CAST(12 AS STRING)`,
      });
    }

    /**
     * 'OperatorsSupportingSequelizeValueMethods' lists all operators
     * that accept values: `col()`, `literal()`, `fn()`, `cast()`, and { [Op.col] }
     */
    type OperatorsSupportingAnyAll<AttributeType> = keyof {
      [Key in keyof WhereOperators<AttributeType>
        as IncludesType<
          WhereOperators<AttributeType>[Key],
          | { [Op.all]: any[] | Utils.Literal | { [Op.values]: any[] } }
          | { [Op.any]: any[] | Utils.Literal | { [Op.values]: any[] } }
        > extends true ? Key : never
      ]: WhereOperators<AttributeType>[Key]
    };

    /**
     * Tests whether an operator is compatible with:
     * - Op.any (+ Op.values)
     * - Op.all (+ Op.values)
     *
     * If there is a typescript error on the operator passed to this function, then
     * the typings in {@link WhereOperators} for the provided operator are incorrect.
     *
     * @param operator
     * @param sqlOperator
     * @param testWithValues
     */
    function testSupportsAnyAll<TestWithValue>(
      operator: OperatorsSupportingAnyAll<TestWithValue>,
      sqlOperator: string,
      testWithValues: TestWithValue[],
    ) {
      if (!dialectSupportsArray()) {
        return;
      }

      const arrayOperators: Array<[jsOp: symbol, sqlOp: string]> = [
        [Op.any, 'ANY'],
        [Op.all, 'ALL'],
      ];
      for (const [arrayOperator, arraySqlOperator] of arrayOperators) {
        // doesn't work at all
        testSql.skip({ intAttr1: { [operator]: { [arrayOperator]: testWithValues } } }, {
          default: `[intAttr1] ${sqlOperator} ${arraySqlOperator} (ARRAY[${testWithValues.map(v => util.inspect(v)).join(',')}])`,
        });

        testSql({ intAttr1: { [operator]: { [arrayOperator]: literal('literal') } } }, {
          default: `[intAttr1] ${sqlOperator} ${arraySqlOperator} (literal)`,
        });

        // e.g. "col" LIKE ANY (VALUES ("col2"))
        testSql.skip({
          intAttr1: {
            [operator]: {
              [arrayOperator]: {
                [Op.values]: [
                  literal('literal'),
                  fn('UPPER', col('col2')),
                  col('col3'),
                  cast(col('col'), 'string'),
                  'abc',
                  12,
                ],
              },
            },
          },
        }, {
          default: `[intAttr1] ${sqlOperator} ${arraySqlOperator} (VALUES (literal), (UPPER("col2")), ("col3"), (CAST("col" AS STRING)), ('abc'), (12))`,
        });
      }
    }

    const testSql = createTester(
      (it, whereObj: TestModelWhere, expectations: Expectations, options?: Options) => {
        it(util.inspect(whereObj, { depth: 10 }) + (options ? `, ${util.inspect(options)}` : ''), () => {
          const sqlOrError = attempt(sql.whereItemsQuery.bind(sql), whereObj, {
            ...options,
            model: TestModel,
          });

          return expectsql(sqlOrError, expectations);
        });
      },
    );

    testSql({}, {
      default: '',
    });

    testSql([], {
      default: '',
    });

    // @ts-expect-error id is not allowed to be undefined
    testSql({ intAttr1: undefined }, {
      default: new Error('WHERE parameter "intAttr1" has invalid "undefined" value'),
    });

    // @ts-expect-error user does not exist
    testSql({ intAttr1: 1, user: undefined }, {
      default: new Error('WHERE parameter "user" has invalid "undefined" value'),
    });

    // @ts-expect-error user does not exist
    testSql({ intAttr1: 1, user: undefined }, {
      default: new Error('WHERE parameter "user" has invalid "undefined" value'),
    }, { type: QueryTypes.SELECT });

    // @ts-expect-error user does not exist
    testSql({ intAttr1: 1, user: undefined }, {
      default: new Error('WHERE parameter "user" has invalid "undefined" value'),
    }, { type: QueryTypes.BULKDELETE });

    // @ts-expect-error user does not exist
    testSql({ intAttr1: 1, user: undefined }, {
      default: new Error('WHERE parameter "user" has invalid "undefined" value'),
    }, { type: QueryTypes.BULKUPDATE });

    testSql({ intAttr1: 1 }, {
      default: '[User].[intAttr1] = 1',
    }, { prefix: 'User' });

    it('{ id: 1 }, { prefix: literal(sql.quoteTable.call(sequelize.dialect.queryGenerator, {schema: \'yolo\', tableName: \'User\'})) }', () => {
      expectsql(sql.whereItemsQuery({ id: 1 }, {
        prefix: literal(sql.quoteTable.call(sequelize.dialect.queryGenerator, {
          schema: 'yolo',
          tableName: 'User',
        })),
      }), {
        default: '[yolo].[User].[id] = 1',
      });
    });

    testSql(literal('raw sql'), {
      default: 'raw sql',
    });

    describe('value serialization', () => {
      // string
      testSql({ stringAttr: '1' }, {
        default: `[stringAttr] = '1'`,
        mssql: `[stringAttr] = N'1'`,
      });

      testSql({
        stringAttr: 'here is a null char: \0',
      }, {
        default: '[stringAttr] = \'here is a null char: \\0\'',
        snowflake: '"stringAttr" = \'here is a null char: \0\'',
        mssql: '[stringAttr] = N\'here is a null char: \0\'',
        db2: '"stringAttr" = \'here is a null char: \0\'',
        ibmi: '"stringAttr" = \'here is a null char: \0\'',
        sqlite: '`stringAttr` = \'here is a null char: \0\'',
      });

      testSql({
        dateAttr: 1_356_998_400_000,
      }, {
        default: '[dateAttr] = \'2013-01-01 00:00:00.000 +00:00\'',
        mssql: '[dateAttr] = N\'2013-01-01 00:00:00.000 +00:00\'',
      });

      describe('Buffer', () => {
        testSql({ stringAttr: Buffer.from('Sequelize') }, {
          ibmi: '"stringAttr" = BLOB(X\'53657175656c697a65\')',
          postgres: '"stringAttr" = E\'\\\\x53657175656c697a65\'',
          sqlite: '`stringAttr` = X\'53657175656c697a65\'',
          mariadb: '`stringAttr` = X\'53657175656c697a65\'',
          mysql: '`stringAttr` = X\'53657175656c697a65\'',
          db2: '"stringAttr" = BLOB(\'Sequelize\')',
          snowflake: '"stringAttr" = X\'53657175656c697a65\'',
          mssql: '[stringAttr] = 0x53657175656c697a65',
        });

        testSql({ stringAttr: [Buffer.from('Sequelize1'), Buffer.from('Sequelize2')] }, {
          postgres: '"stringAttr" IN (E\'\\\\x53657175656c697a6531\', E\'\\\\x53657175656c697a6532\')',
          sqlite: '`stringAttr` IN (X\'53657175656c697a6531\', X\'53657175656c697a6532\')',
          mariadb: '`stringAttr` IN (X\'53657175656c697a6531\', X\'53657175656c697a6532\')',
          mysql: '`stringAttr` IN (X\'53657175656c697a6531\', X\'53657175656c697a6532\')',
          db2: '"stringAttr" IN (BLOB(\'Sequelize1\'), BLOB(\'Sequelize2\'))',
          snowflake: '"stringAttr" IN (X\'53657175656c697a6531\', X\'53657175656c697a6532\')',
          mssql: '[stringAttr] IN (0x53657175656c697a6531, 0x53657175656c697a6532)',
        });
      });
    });

    describe('implicit operator', () => {
      testSql({ intAttr1: 1 }, {
        default: '[intAttr1] = 1',
      });

      testSql({ intAttr1: '1' }, {
        default: `[intAttr1] = '1'`,
        mssql: `[intAttr1] = N'1'`,
      });

      testSql({ intAttr1: [1, 2] }, {
        default: '[intAttr1] IN (1, 2)',
      });

      testSql({ intAttr1: ['1', '2'] }, {
        default: `[intAttr1] IN ('1', '2')`,
        mssql: `[intAttr1] IN (N'1', N'2')`,
      });

      testSql.skip({ 'stringAttr::integer': 1 }, {
        default: 'CAST([stringAttr] AS INTEGER) = 1',
      });

      testSql({ $intAttr1$: 1 }, {
        default: '[intAttr1] = 1',
      });

      testSql.skip({ '$stringAttr$::integer': 1 }, {
        default: 'CAST([stringAttr] AS INTEGER) = 1',
      });

      testSql({ booleanAttr: true }, {
        default: `[booleanAttr] = true`,
        mssql: '[booleanAttr] = 1',
        sqlite: '`booleanAttr` = 1',
      });

      testSql({
        stringAttr: 'a project',
        intAttr1: {
          [Op.or]: [
            [1, 2, 3],
            { [Op.gt]: 10 },
          ],
        },
      }, {
        default: '[stringAttr] = \'a project\' AND ([intAttr1] IN (1, 2, 3) OR [intAttr1] > 10)',
        mssql: '[stringAttr] = N\'a project\' AND ([intAttr1] IN (1, 2, 3) OR [intAttr1] > 10)',
      });

      testSql({ nullableIntAttr: null }, {
        default: '[nullableIntAttr] IS NULL',
      });

      testSql({ dateAttr: new Date('2021-01-01T00:00:00Z') }, {
        default: `[dateAttr] = '2021-01-01 00:00:00.000 +00:00'`,
        mariadb: `\`dateAttr\` = '2021-01-01 00:00:00.000'`,
        mysql: `\`dateAttr\` = '2021-01-01 00:00:00'`,
        snowflake: `"dateAttr" = '2021-01-01 00:00:00'`,
        db2: `"dateAttr" = '2021-01-01 00:00:00'`,
      });

      testSql({ intAttr1: { [Op.col]: 'intAttr2' } }, {
        default: '[intAttr1] = [intAttr2]',
      });

      testSql.skip({ intAttr1: col('intAttr2') }, {
        default: '[intAttr1] = [intAttr2]',
      });

      testSql.skip({ intAttr1: literal('literal') }, {
        default: '[intAttr1] = literal',
      });

      testSql({ stringAttr: fn('UPPER', col('stringAttr')) }, {
        default: '[stringAttr] = UPPER([stringAttr])',
      });

      testSql.skip({ stringAttr: cast(col('intAttr1'), 'string') }, {
        default: '[stringAttr] = CAST([intAttr1] AS STRING)',
      });

      testSql.skip({ stringAttr: cast('abc', 'string') }, {
        default: `[stringAttr] = CAST('abc' AS STRING)`,
      });

      if (dialectSupportsArray()) {
        testSql({ intArrayAttr: [1, 2] }, {
          default: `[intArrayAttr] = ARRAY[1,2]::INTEGER[]`,
        });

        testSql({ intArrayAttr: [] }, {
          default: `[intArrayAttr] = ARRAY[]::INTEGER[]`,
        });

        // when using arrays, Op.in is never included
        // @ts-expect-error -- Omitting the operator with an array attribute is always Op.eq, never Op.in
        testSql.skip({ intArrayAttr: [[1, 2]] }, {
          default: new Error(`"intArrayAttr" cannot be compared to [[1, 2]], did you mean to use Op.in?`),
        });

        testSql.skip({ intAttr1: { [Op.any]: [2, 3, 4] } }, {
          default: '[intAttr1] = ANY (ARRAY[2,3,4])',
        });

        testSql({ intAttr1: { [Op.any]: literal('literal') } }, {
          default: '[intAttr1] = ANY (literal)',
        });

        testSql({ intAttr1: { [Op.any]: { [Op.values]: [col('col')] } } }, {
          default: '[intAttr1] = ANY (VALUES ([col]))',
        });

        testSql.skip({ intAttr1: { [Op.all]: [2, 3, 4] } }, {
          default: '[intAttr1] = ALL (ARRAY[2,3,4])',
        });

        testSql({ intAttr1: { [Op.all]: literal('literal') } }, {
          default: '[intAttr1] = ALL (literal)',
        });

        testSql({ intAttr1: { [Op.all]: { [Op.values]: [col('col')] } } }, {
          default: '[intAttr1] = ALL (VALUES ([col]))',
        });

        // e.g. "col" LIKE ANY (VALUES ("col2"))
        testSql({
          intAttr1: {
            [Op.any]: {
              [Op.values]: [
                literal('literal'),
                fn('UPPER', col('col2')),
                col('col3'),
                cast(col('col'), 'string'),
                'abc',
                1,
              ],
            },
          },
        }, {
          default: `[intAttr1] = ANY (VALUES (literal), (UPPER([col2])), ([col3]), (CAST([col] AS STRING)), ('abc'), (1))`,
        });
      }
    });

    describe('Op.eq', () => {
      testSql({ intAttr1: { [Op.eq]: 1 } }, {
        default: '[intAttr1] = 1',
      });

      testSql.skip({ 'intAttr1::integer': { [Op.eq]: 1 } }, {
        default: 'CAST([intAttr1] AS INTEGER) = 1',
      });

      testSql({ $intAttr1$: { [Op.eq]: 1 } }, {
        default: '[intAttr1] = 1',
      });

      testSql.skip({ '$intAttr1$::integer': { [Op.eq]: 1 } }, {
        default: 'CAST([intAttr1] AS INTEGER) = 1',
      });

      if (dialectSupportsArray()) {
        // @ts-expect-error - intArrayAttr is not an array
        const ignore: TestModelWhere = { intAttr1: { [Op.eq]: [1, 2] } };

        testSql({ intArrayAttr: { [Op.eq]: [1, 2] } }, {
          default: '[intArrayAttr] = ARRAY[1,2]::INTEGER[]',
        });
      }

      {
        // @ts-expect-error - intAttr1 is not nullable
        const ignore: TestModelWhere = { intAttr1: { [Op.eq]: null } };

        // this one is
        testSql({ nullableIntAttr: { [Op.eq]: null } }, {
          default: '[nullableIntAttr] IS NULL',
        });
      }

      testSql({ booleanAttr: { [Op.eq]: true } }, {
        default: '[booleanAttr] = true',
      });

      testSequelizeValueMethods(Op.eq, '=');
      testSupportsAnyAll(Op.eq, '=', [2, 3, 4]);
    });

    describe('Op.ne', () => {
      testSql({ intAttr1: { [Op.ne]: 1 } }, {
        default: '[intAttr1] != 1',
      });

      if (dialectSupportsArray()) {
        testSql({ intArrayAttr: { [Op.ne]: [1, 2] } }, {
          default: '[intArrayAttr] != ARRAY[1,2]::INTEGER[]',
        });
      }

      testSql({ nullableIntAttr: { [Op.ne]: null } }, {
        default: '[nullableIntAttr] IS NOT NULL',
      });

      testSql({ booleanAttr: { [Op.ne]: true } }, {
        default: '[booleanAttr] != true',
        mssql: '[booleanAttr] != 1',
        ibmi: '"booleanAttr" != 1',
        sqlite: '`booleanAttr` != 1',
      });

      testSequelizeValueMethods(Op.ne, '!=');
      testSupportsAnyAll(Op.ne, '!=', [2, 3, 4]);
    });

    describe('Op.is', () => {
      {
        // @ts-expect-error -- intAttr is not nullable
        const ignore: TestModelWhere = { intAttr: { [Op.is]: null } };
      }

      {
        // @ts-expect-error -- stringAttr is not a boolean
        const ignore: TestModelWhere = { stringAttr: { [Op.is]: true } };
      }

      testSql({ nullableIntAttr: { [Op.is]: null } }, {
        default: '[nullableIntAttr] IS NULL',
      });

      testSql({ booleanAttr: { [Op.is]: false } }, {
        default: '[booleanAttr] IS false',
        mssql: '[booleanAttr] IS 0',
        ibmi: '"booleanAttr" IS 0',
        sqlite: '`booleanAttr` IS 0',
      });

      testSql({ booleanAttr: { [Op.is]: true } }, {
        default: '[booleanAttr] IS true',
        mssql: '[booleanAttr] IS 1',
        ibmi: '"booleanAttr" IS 1',
        sqlite: '`booleanAttr` IS 1',
      });

      // @ts-expect-error
      testSql.skip({ intAttr1: { [Op.is]: 1 } }, {
        default: new Error('Op.is expected a boolean or null, but received 1'),
      });

      // @ts-expect-error
      testSql.skip({ intAttr1: { [Op.is]: { [Op.col]: 'intAttr2' } } }, {
        default: new Error('column references are not supported by Op.is'),
      });

      // @ts-expect-error
      testSql.skip({ intAttr1: { [Op.is]: col('intAttr2') } }, {
        default: new Error('column references are not supported by Op.is'),
      });

      testSql({ intAttr1: { [Op.is]: literal('literal') } }, {
        default: '[intAttr1] IS literal',
      });

      // @ts-expect-error
      testSql.skip({ intAttr1: { [Op.is]: fn('UPPER', col('intAttr2')) } }, {
        default: new Error('SQL functions are not supported by Op.is'),
      });

      // @ts-expect-error
      testSql.skip({ intAttr1: { [Op.is]: cast(col('intAttr2'), 'boolean') } }, {
        default: new Error('CAST is not supported by Op.is'),
      });

      if (dialectSupportsArray()) {
        // @ts-expect-error
        testSql.skip({ intAttr1: { [Op.is]: { [Op.any]: [2, 3] } } }, {
          default: new Error('Op.any is not supported by Op.is'),
        });

        // @ts-expect-error
        testSql.skip({ intAttr1: { [Op.is]: { [Op.all]: [2, 3, 4] } } }, {
          default: new Error('Op.all is not supported by Op.is'),
        });
      }
    });

    describe('Op.not', () => {
      testSql({ [Op.not]: {} }, {
        default: '0 = 1',
      });

      testSql({ [Op.not]: [] }, {
        default: '0 = 1',
      });

      testSql({ nullableIntAttr: { [Op.not]: null } }, {
        default: '[nullableIntAttr] IS NOT NULL',
      });

      testSql({ booleanAttr: { [Op.not]: false } }, {
        default: '[booleanAttr] IS NOT false',
        mssql: '[booleanAttr] IS NOT 0',
        ibmi: '"booleanAttr" IS NOT 0',
        sqlite: '`booleanAttr` IS NOT 0',
      });

      testSql({ booleanAttr: { [Op.not]: true } }, {
        default: '[booleanAttr] IS NOT true',
        mssql: '[booleanAttr] IS NOT 1',
        ibmi: '"booleanAttr" IS NOT 1',
        sqlite: '`booleanAttr` IS NOT 1',
      });

      testSql({ intAttr1: { [Op.not]: 1 } }, {
        default: '[intAttr1] != 1',
      });

      testSequelizeValueMethods(Op.not, '!=');
      testSupportsAnyAll(Op.not, '!=', [2, 3, 4]);

      {
        // @ts-expect-error -- not a valid query: attribute does not exist.
        const ignore: TestModelWhere = { [Op.not]: { doesNotExist: 5 } };
      }

      testSql({ [Op.not]: { intAttr1: 5 } }, {
        default: 'NOT ([intAttr1] = 5)',
      });

      testSql({ [Op.not]: { intAttr1: { [Op.gt]: 5 } } }, {
        default: 'NOT ([intAttr1] > 5)',
      });

      testSql.skip({ [Op.not]: where(col('intAttr1'), Op.eq, '5') }, {
        default: 'NOT ([intAttr1] = 5)',
      });

      testSql.skip({ [Op.not]: json('data.key', 10) }, {
        default: 'NOT (([data]#>>\'{key}\') = 10)',
      });

      testSql.skip({ intAttr1: { [Op.not]: { [Op.gt]: 5 } } }, {
        default: 'NOT ([intAttr1] > 5)',
      });
    });

    function describeComparisonSuite(
      operator: typeof Op.gt | typeof Op.gte | typeof Op.lt | typeof Op.lte,
      sqlOperator: string,
    ) {
      // ensure gte, gt, lte, lt support the same typings, so we only have to test their typings once.
      // unfortunately, at time of writing (TS 4.5.5), TypeScript
      //  does not detect an error in `{ [operator]: null }`
      //  but it does detect an error in { [Op.gt]: null }`
      expectTypeOf<WhereOperators[typeof Op.gte]>().toEqualTypeOf<WhereOperators[typeof Op.gt]>();
      expectTypeOf<WhereOperators[typeof Op.lt]>().toEqualTypeOf<WhereOperators[typeof Op.gt]>();
      expectTypeOf<WhereOperators[typeof Op.lte]>().toEqualTypeOf<WhereOperators[typeof Op.gt]>();

      describe(`Op.${operator.description}`, () => {
        {
          const ignore: TestModelWhere = { intAttr1: { [Op.gt]: 1 } };
          testSql({ intAttr1: { [operator]: 1 } }, {
            default: `[intAttr1] ${sqlOperator} 1`,
          });
        }

        {
          const ignore: TestModelWhere = { stringAttr: { [Op.gt]: 'abc' } };
          testSql({ stringAttr: { [operator]: 'abc' } }, {
            default: `[stringAttr] ${sqlOperator} 'abc'`,
          });
        }

        if (dialectSupportsArray()) {
          const ignore: TestModelWhere = { intArrayAttr: { [Op.gt]: [1, 2] } };
          testSql({ intArrayAttr: { [operator]: [1, 2] } }, {
            default: `[intArrayAttr] ${sqlOperator} ARRAY[1,2]::INTEGER[]`,
          });
        }

        expectTypeOf({ intAttr1: { [Op.gt]: null } }).not.toMatchTypeOf<WhereOperators>();
        testSql.skip({ intAttr1: { [operator]: null } }, {
          default: new Error(`Op.${operator.description} cannot be used with null`),
        });

        testSequelizeValueMethods(operator, sqlOperator);
        testSupportsAnyAll(operator, sqlOperator, [2, 3, 4]);
      });
    }

    describeComparisonSuite(Op.gt, '>');
    describeComparisonSuite(Op.gte, '>=');
    describeComparisonSuite(Op.lt, '<');
    describeComparisonSuite(Op.lte, '<=');

    function describeBetweenSuite(
      operator: typeof Op.between | typeof Op.notBetween,
      sqlOperator: string,
    ) {
      // ensure between and notBetween support the same typings, so we only have to test their typings once.
      // unfortunately, at time of writing (TS 4.5.5), TypeScript
      //  does not detect an error in `{ [operator]: null }`
      //  but it does detect an error in { [Op.gt]: null }`
      expectTypeOf<WhereOperators[typeof Op.between]>().toEqualTypeOf<WhereOperators[typeof Op.notBetween]>();

      describe(`Op.${operator.description}`, () => {
        expectTypeOf({ id: { [Op.between]: [1, 2] } }).toMatchTypeOf<TestModelWhere>();
        expectTypeOf({ id: { [Op.between]: [new Date(), new Date()] } }).toMatchTypeOf<TestModelWhere>();
        expectTypeOf({ id: { [Op.between]: ['a', 'b'] } }).toMatchTypeOf<TestModelWhere>();

        // expectTypeOf doesn't work with this one:
        {
          const ignoreRight: TestModelWhere = {
            intAttr1: { [Op.between]: [1, 2] },
          };

          testSql({ intAttr1: { [operator]: [1, 2] } }, {
            default: `[intAttr1] ${sqlOperator} 1 AND 2`,
          });

          // @ts-expect-error -- must pass exactly 2 items
          const ignoreWrong: TestModelWhere = { intAttr1: { [Op.between]: [1, 2, 3] } };

          // @ts-expect-error -- must pass exactly 2 items
          const ignoreWrong2: TestModelWhere = { intAttr1: { [Op.between]: [1] } };

          testSql.skip({ intAttr1: { [operator]: [1] } }, {
            default: new Error(`Op.${operator.description} expects an array of exactly 2 items.`),
          });

          // @ts-expect-error -- must pass exactly 2 items
          const ignoreWrong3: TestModelWhere = { intAttr1: { [Op.between]: [] } };
        }

        {
          const ignoreRight: TestModelWhere = { intArrayAttr: { [Op.between]: [[1, 2], [3, 4]] } };
          testSql({ intArrayAttr: { [operator]: [[1, 2], [3, 4]] } }, {
            default: `[intArrayAttr] ${sqlOperator} ARRAY[1,2]::INTEGER[] AND ARRAY[3,4]::INTEGER[]`,
          });
        }

        {
          // @ts-expect-error - this is not valid because intAttr1 is not an array and cannot be compared to arrays
          const ignore: TestModelWhere = { intAttr1: { [Op.between]: [[1, 2], [3, 4]] } };
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.between]: [col('col1'), col('col2')] } };
          testSql({ intAttr1: { [operator]: [col('col1'), col('col2')] } }, {
            default: `[intAttr1] ${sqlOperator} [col1] AND [col2]`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.between]: [literal('literal1'), literal('literal2')] } };
          testSql({ intAttr1: { [operator]: [literal('literal1'), literal('literal2')] } }, {
            default: `[intAttr1] ${sqlOperator} literal1 AND literal2`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.between]: [fn('NOW'), fn('NOW')] } };
          testSql({ intAttr1: { [operator]: [fn('NOW'), fn('NOW')] } }, {
            default: `[intAttr1] ${sqlOperator} NOW() AND NOW()`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.between]: [{ [Op.col]: 'col1' }, { [Op.col]: 'col2' }] } };
          testSql.skip({ intAttr1: { [operator]: [{ [Op.col]: 'col1' }, { [Op.col]: 'col2' }] } }, {
            default: `[intAttr1] ${sqlOperator} "col1" AND "col2"`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.between]: [cast(col('col'), 'string'), cast(col('col'), 'string')] } };
          testSql({ intAttr1: { [operator]: [cast(col('col'), 'string'), cast(col('col'), 'string')] } }, {
            default: `[intAttr1] ${sqlOperator} CAST([col] AS STRING) AND CAST([col] AS STRING)`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.between]: literal('literal1 AND literal2') } };
          testSql.skip({ intAttr1: { [operator]: literal('literal1 AND literal2') } }, {
            default: `[intAttr1] ${sqlOperator} BETWEEN literal1 AND literal2`,
          });
        }
      });
    }

    describeBetweenSuite(Op.between, 'BETWEEN');
    describeBetweenSuite(Op.notBetween, 'NOT BETWEEN');

    function describeInSuite(
      operator: typeof Op.in | typeof Op.notIn,
      sqlOperator: string,
      extraTests: () => void,
    ): void {
      // ensure between and notBetween support the same typings, so we only have to test their typings once.
      // unfortunately, at time of writing (TS 4.5.5), TypeScript
      //  does not detect an error in `{ [operator]: null }`
      //  but it does detect an error in { [Op.gt]: null }`
      expectTypeOf<WhereOperators[typeof Op.between]>().toEqualTypeOf<WhereOperators[typeof Op.notBetween]>();

      describe(`Op.${operator.description}`, () => {
        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.in]: [1, 2, 3] } };
          testSql({ intAttr1: { [operator]: [1, 2, 3] } }, {
            default: `[intAttr1] ${sqlOperator} (1, 2, 3)`,
          });
        }

        if (dialectSupportsArray()) {
          {
            // valid
            const ignore: TestModelWhere = { intArrayAttr: { [Op.in]: [[1, 2], [3, 4]] } };
            testSql({ intArrayAttr: { [operator]: [[1, 2], [3, 4]] } }, {
              default: `[intArrayAttr] ${sqlOperator} (ARRAY[1,2]::INTEGER[], ARRAY[3,4]::INTEGER[])`,
            });
          }

          {
            // @ts-expect-error -- intAttr1 is not an array
            const ignore: TestModelWhere = { intAttr1: { [Op.in]: [[1, 2], [3, 4]] } };
            testSql({ intArrayAttr: { [operator]: [[1, 2], [3, 4]] } }, {
              default: `[intArrayAttr] ${sqlOperator} (ARRAY[1,2]::INTEGER[], ARRAY[3,4]::INTEGER[])`,
            });
          }
        }

        {
          // @ts-expect-error -- this is invalid because intAttr1 is not an array and cannot be compared to arrays.
          const ignore: TestModelWhere = { intAttr1: { [Op.in]: [[1, 2], [3, 4]] } };
        }

        {
          // @ts-expect-error
          const ignoreWrong: TestModelWhere = { intAttr1: { [Op.in]: 1 } };
          testSql.skip({ intAttr1: { [operator]: 1 } }, {
            default: new Error(`Op.${operator.description} expects an array.`),
          });
        }

        {
          // @ts-expect-error
          const ignoreWrong: TestModelWhere = { intAttr1: { [Op.in]: col('col2') } };
          testSql.skip({ intAttr1: { [operator]: col('col1') } }, {
            default: new Error(`Op.${operator.description} expects an array.`),
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.in]: [col('col1'), col('col2')] } };
          testSql({ intAttr1: { [operator]: [col('col1'), col('col2')] } }, {
            default: `[intAttr1] ${sqlOperator} ([col1], [col2])`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.in]: [literal('literal1'), literal('literal2')] } };
          testSql({ intAttr1: { [operator]: [literal('literal1'), literal('literal2')] } }, {
            default: `[intAttr1] ${sqlOperator} (literal1, literal2)`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.in]: [fn('NOW'), fn('NOW')] } };
          testSql({ intAttr1: { [operator]: [fn('NOW'), fn('NOW')] } }, {
            default: `[intAttr1] ${sqlOperator} (NOW(), NOW())`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.in]: [{ [Op.col]: 'col1' }, { [Op.col]: 'col2' }] } };
          testSql.skip({ intAttr1: { [operator]: [{ [Op.col]: 'col1' }, { [Op.col]: 'col2' }] } }, {
            default: `[intAttr1] ${sqlOperator} ("col1", "col2")`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.in]: [cast(col('col'), 'string'), cast(col('col'), 'string')] } };
          testSql({ intAttr1: { [operator]: [cast(col('col'), 'string'), cast(col('col'), 'string')] } }, {
            default: `[intAttr1] ${sqlOperator} (CAST([col] AS STRING), CAST([col] AS STRING))`,
          });
        }

        {
          const ignoreRight: TestModelWhere = { intAttr1: { [Op.in]: literal('literal') } };
          testSql({ intAttr1: { [operator]: literal('literal') } }, {
            default: `[intAttr1] ${sqlOperator} literal`,
          });
        }

        {
          // @ts-expect-error -- Op.all is not compatible with Op.in
          const ignoreWrong: TestModelWhere = { intAttr1: { [Op.in]: { [Op.all]: [] } } };
        }

        extraTests();
      });
    }

    describeInSuite(Op.in, 'IN', () => {
      testSql({ intAttr1: { [Op.in]: [] } }, {
        default: '[intAttr1] IN (NULL)',
      });
    });

    describeInSuite(Op.notIn, 'NOT IN', () => {
      testSql({ intAttr1: { [Op.notIn]: [] } }, {
        default: '',
      });
    });

    function describeLikeSuite(
      operator: typeof Op.like | typeof Op.notLike | typeof Op.iLike | typeof Op.notILike,
      sqlOperator: string,
    ) {
      // ensure like ops support the same typings, so we only have to test their typings once.
      // unfortunately, at time of writing (TS 4.5.5), TypeScript
      //  does not detect an error in `{ [operator]: null }`
      //  but it does detect an error in { [Op.iLike]: null }`
      expectTypeOf<WhereOperators[typeof Op.notLike]>().toEqualTypeOf<WhereOperators[typeof Op.like]>();
      expectTypeOf<WhereOperators[typeof Op.iLike]>().toEqualTypeOf<WhereOperators[typeof Op.like]>();
      expectTypeOf<WhereOperators[typeof Op.notILike]>().toEqualTypeOf<WhereOperators[typeof Op.like]>();

      describe(`Op.${operator.description}`, () => {
        expectTypeOf({ stringAttr: { [Op.like]: '%id' } }).toMatchTypeOf<TestModelWhere>();
        testSql({ stringAttr: { [operator]: '%id' } }, {
          default: `[stringAttr] ${sqlOperator} '%id'`,
        });

        testSequelizeValueMethods(operator, sqlOperator);
        testSupportsAnyAll(operator, sqlOperator, ['a', 'b', 'c']);
      });
    }

    describeLikeSuite(Op.like, 'LIKE');
    describeLikeSuite(Op.notLike, 'NOT LIKE');
    describeLikeSuite(Op.iLike, 'ILIKE');
    describeLikeSuite(Op.notILike, 'NOT ILIKE');

    function describeOverlapSuite(
      operator: typeof Op.overlap | typeof Op.contains | typeof Op.contained,
      sqlOperator: string,
    ) {

      if (!dialectSupportsArray()) {
        return;
      }

      expectTypeOf<WhereOperators[typeof Op.contains]>().toEqualTypeOf<WhereOperators[typeof Op.overlap]>();
      expectTypeOf<WhereOperators[typeof Op.contained]>().toEqualTypeOf<WhereOperators[typeof Op.overlap]>();

      describe(`Op.${operator.description}`, () => {
        {
          const ignoreRight: TestModelWhere = { intArrayAttr: { [Op.overlap]: [1, 2, 3] } };
          testSql({ intArrayAttr: { [operator]: [1, 2, 3] } }, {
            default: `[intArrayAttr] ${sqlOperator} ARRAY[1,2,3]::INTEGER[]`,
          });
        }

        testSequelizeValueMethods(operator, sqlOperator);
        // testSupportsAnyAll(operator, sqlOperator, [[1, 2], [1, 2]]);

        {
          // @ts-expect-error
          const ignoreWrong: TestModelWhere = { intArrayAttr: { [Op.overlap]: [col('col')] } };
          testSql.skip({ intArrayAttr: { [operator]: [col('col')] } }, {
            default: new Error(`Op.${operator.description} does not support arrays of cols`),
          });
        }

        {
          // @ts-expect-error
          const ignoreWrong: TestModelWhere = { intArrayAttr: { [Op.overlap]: [{ [Op.col]: 'col' }] } };
          testSql.skip({ intArrayAttr: { [operator]: [{ [Op.col]: 'col' }] } }, {
            default: new Error(`Op.${operator.description} does not support arrays of cols`),
          });
        }

        {
          // @ts-expect-error
          const ignoreWrong: TestModelWhere = { intArrayAttr: { [Op.overlap]: [literal('literal')] } };
          testSql.skip({ intArrayAttr: { [operator]: [literal('literal')] } }, {
            default: new Error(`Op.${operator.description} does not support arrays of literals`),
          });
        }

        {
          // @ts-expect-error
          const ignoreWrong: TestModelWhere = { intArrayAttr: { [Op.overlap]: [fn('NOW')] } };
          testSql.skip({ intArrayAttr: { [operator]: [fn('NOW')] } }, {
            default: new Error(`Op.${operator.description} does not support arrays of fn`),
          });
        }

        {
          // @ts-expect-error
          const ignoreWrong: TestModelWhere = { intArrayAttr: { [Op.overlap]: [cast(col('col'), 'string')] } };
          testSql.skip({ intArrayAttr: { [operator]: [cast(col('col'), 'string')] } }, {
            default: new Error(`Op.${operator.description} does not support arrays of cast`),
          });
        }
      });
    }

    describeOverlapSuite(Op.overlap, '&&');
    describeOverlapSuite(Op.contains, '@>');
    describeOverlapSuite(Op.contained, '<@');

    describe('Op.startsWith', () => {
      testSql({
        stringAttr: {
          [Op.startsWith]: 'swagger',
        },
      }, {
        default: `[stringAttr] LIKE 'swagger%'`,
        mssql: `[stringAttr] LIKE N'swagger%'`,
      });

      testSql({
        stringAttr: {
          [Op.startsWith]: 'sql\'injection',
        },
      }, {
        default: `[stringAttr] LIKE 'sql''injection%'`,
        mssql: `[stringAttr] LIKE N'sql''injection%'`,
      });

      // startsWith should escape anything that has special meaning in LIKE
      testSql.skip({
        stringAttr: {
          [Op.startsWith]: 'like%injection',
        },
      }, {
        default: String.raw`[stringAttr] LIKE 'sql\%injection%' ESCAPE '\'`,
        mssql: String.raw`[stringAttr] LIKE N'sql\%injection%' ESCAPE '\'`,
      });

      // TODO: remove this test in v7 (breaking change)
      testSql({
        stringAttr: {
          [Op.startsWith]: literal('swagger'),
        },
      }, {
        default: `[stringAttr] LIKE 'swagger%'`,
        mssql: `[stringAttr] LIKE N'swagger%'`,
      });

      // TODO: in v7: support `col`, `literal`, and others
      // TODO: these would require escaping LIKE values in SQL itself
      //  output should be something like:
      //  `LIKE CONCAT(ESCAPE($bind, '%', '\\%'), '%') ESCAPE '\\'`
      //  with missing special characters.
      testSql.skip({
        stringAttr: {
          [Op.startsWith]: literal('$bind'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT($bind, '%')`,
        mssql: `[stringAttr] LIKE CONCAT($bind, N'%')`,
      });

      testSql.skip({
        stringAttr: {
          [Op.startsWith]: col('username'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT("username", '%')`,
        mssql: `[stringAttr] LIKE CONCAT("username", N'%')`,
      });

      testSql.skip({
        stringAttr: {
          [Op.startsWith]: { [Op.col]: 'username' },
        },
      }, {
        default: `[stringAttr] LIKE CONCAT("username", '%')`,
        mssql: `[stringAttr] LIKE CONCAT("username", N'%')`,
      });

      testSql.skip({
        stringAttr: {
          [Op.startsWith]: fn('NOW'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT(NOW(), '%')`,
        mssql: `[stringAttr] LIKE CONCAT(NOW(), N'%')`,
      });

      testSql.skip({
        stringAttr: {
          [Op.startsWith]: cast(fn('NOW'), 'string'),
        },
      }, {
        default: `[username] LIKE CONCAT(CAST(NOW() AS STRING), '%')`,
        mssql: `[username] LIKE CONCAT(CAST(NOW() AS STRING), N'%')`,
      });

      // these cannot be compatible because it's not possible to provide a ESCAPE clause (although the default ESCAPe is '\')
      // @ts-expect-error -- startsWith is not compatible with Op.any
      testSql.skip({ stringAttr: { [Op.startsWith]: { [Op.any]: ['test'] } } }, {
        default: new Error('Op.startsWith is not compatible with Op.any'),
      });

      // @ts-expect-error -- startsWith is not compatible with Op.all
      testSql.skip({ stringAttr: { [Op.startsWith]: { [Op.all]: ['test'] } } }, {
        default: new Error('Op.startsWith is not compatible with Op.all'),
      });

      // @ts-expect-error -- startsWith is not compatible with Op.any + Op.values
      testSql.skip({ stringAttr: { [Op.startsWith]: { [Op.any]: { [Op.values]: ['test'] } } } }, {
        default: new Error('Op.startsWith is not compatible with Op.any'),
      });

      // @ts-expect-error -- startsWith is not compatible with Op.all + Op.values
      testSql.skip({ stringAttr: { [Op.startsWith]: { [Op.all]: { [Op.values]: ['test'] } } } }, {
        default: new Error('Op.startsWith is not compatible with Op.all'),
      });
    });

    describe('Op.endsWith', () => {
      testSql({
        stringAttr: {
          [Op.endsWith]: 'swagger',
        },
      }, {
        default: `[stringAttr] LIKE '%swagger'`,
        mssql: `[stringAttr] LIKE N'%swagger'`,
      });

      testSql({
        stringAttr: {
          [Op.endsWith]: 'sql\'injection',
        },
      }, {
        default: `[stringAttr] LIKE '%sql''injection'`,
        mssql: `[stringAttr] LIKE N'%sql''injection'`,
      });

      // endsWith should escape anything that has special meaning in LIKE
      testSql.skip({
        stringAttr: {
          [Op.endsWith]: 'like%injection',
        },
      }, {
        default: String.raw`[stringAttr] LIKE '%sql\%injection' ESCAPE '\'`,
        mssql: String.raw`[stringAttr] LIKE N'%sql\%injection' ESCAPE '\'`,
      });

      // TODO: remove this test in v7 (breaking change)
      testSql({
        stringAttr: {
          [Op.endsWith]: literal('swagger'),
        },
      }, {
        default: `[stringAttr] LIKE '%swagger'`,
        mssql: `[stringAttr] LIKE N'%swagger'`,
      });

      // TODO: in v7: support `col`, `literal`, and others
      // TODO: these would require escaping LIKE values in SQL itself
      //  output should be something like:
      //  `LIKE CONCAT(ESCAPE($bind, '%', '\\%'), '%') ESCAPE '\\'`
      //  with missing special characters.
      testSql.skip({
        stringAttr: {
          [Op.endsWith]: literal('$bind'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', $bind)`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', $bind)`,
      });

      testSql.skip({
        stringAttr: {
          [Op.endsWith]: col('username'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', "username")`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', "username")`,
      });

      testSql.skip({
        stringAttr: {
          [Op.endsWith]: { [Op.col]: 'username' },
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', "username")`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', "username")`,
      });

      testSql.skip({
        stringAttr: {
          [Op.endsWith]: fn('NOW'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', NOW())`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', NOW())`,
      });

      testSql.skip({
        stringAttr: {
          [Op.endsWith]: cast(fn('NOW'), 'string'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', CAST(NOW() AS STRING))`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', CAST(NOW() AS STRING))`,
      });

      // these cannot be compatible because it's not possible to provide a ESCAPE clause (although the default ESCAPE is '\')
      // @ts-expect-error -- startsWith is not compatible with Op.any
      testSql.skip({ stringAttr: { [Op.endsWith]: { [Op.any]: ['test'] } } }, {
        default: new Error('Op.endsWith is not compatible with Op.any'),
      });

      // @ts-expect-error -- startsWith is not compatible with Op.all
      testSql.skip({ stringAttr: { [Op.endsWith]: { [Op.all]: ['test'] } } }, {
        default: new Error('Op.endsWith is not compatible with Op.all'),
      });

      // @ts-expect-error -- startsWith is not compatible with Op.any + Op.values
      testSql.skip({ stringAttr: { [Op.endsWith]: { [Op.any]: { [Op.values]: ['test'] } } } }, {
        default: new Error('Op.endsWith is not compatible with Op.any'),
      });

      // @ts-expect-error -- startsWith is not compatible with Op.all + Op.values
      testSql.skip({ stringAttr: { [Op.endsWith]: { [Op.all]: { [Op.values]: ['test'] } } } }, {
        default: new Error('Op.endsWith is not compatible with Op.all'),
      });
    });

    describe('Op.substring', () => {
      testSql({
        stringAttr: {
          [Op.substring]: 'swagger',
        },
      }, {
        default: `[stringAttr] LIKE '%swagger%'`,
        mssql: `[stringAttr] LIKE N'%swagger%'`,
      });

      testSql({
        stringAttr: {
          [Op.substring]: 'sql\'injection',
        },
      }, {
        default: `[stringAttr] LIKE '%sql''injection%'`,
        mssql: `[stringAttr] LIKE N'%sql''injection%'`,
      });

      // substring should escape anything that has special meaning in LIKE
      testSql.skip({
        stringAttr: {
          [Op.substring]: 'like%injection',
        },
      }, {
        default: String.raw`[stringAttr] LIKE '%sql\%injection%' ESCAPE '\'`,
        mssql: String.raw`[stringAttr] LIKE N'%sql\%injection%' ESCAPE '\'`,
      });

      // TODO: remove this test in v7 (breaking change)
      testSql({
        stringAttr: {
          [Op.substring]: literal('swagger'),
        },
      }, {
        default: `[stringAttr] LIKE '%swagger%'`,
        mssql: `[stringAttr] LIKE N'%swagger%'`,
      });

      // TODO: in v7: support `col`, `literal`, and others
      // TODO: these would require escaping LIKE values in SQL itself
      //  output should be something like:
      //  `LIKE CONCAT(ESCAPE($bind, '%', '\\%'), '%') ESCAPE '\\'`
      //  with missing special characters.
      testSql.skip({
        stringAttr: {
          [Op.substring]: literal('$bind'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', $bind, '%')`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', $bind, N'%')`,
      });

      testSql.skip({
        stringAttr: {
          [Op.substring]: col('username'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', "username", '%')`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', "username", N'%')`,
      });

      testSql.skip({
        stringAttr: {
          [Op.substring]: { [Op.col]: 'username' },
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', "username", '%')`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', "username", N'%')`,
      });

      testSql.skip({
        stringAttr: {
          [Op.substring]: fn('NOW'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', NOW(), '%')`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', NOW(), N'%')`,
      });

      testSql.skip({
        stringAttr: {
          [Op.substring]: cast(fn('NOW'), 'string'),
        },
      }, {
        default: `[stringAttr] LIKE CONCAT('%', CAST(NOW() AS STRING), '%')`,
        mssql: `[stringAttr] LIKE CONCAT(N'%', CAST(NOW() AS STRING), N'%')`,
      });

      // these cannot be compatible because it's not possible to provide a ESCAPE clause (although the default ESCAPE is '\')
      // @ts-expect-error -- startsWith is not compatible with Op.any
      testSql.skip({ stringAttr: { [Op.substring]: { [Op.any]: ['test'] } } }, {
        default: new Error('Op.substring is not compatible with Op.any'),
      });

      // @ts-expect-error -- startsWith is not compatible with Op.all
      testSql.skip({ stringAttr: { [Op.substring]: { [Op.all]: ['test'] } } }, {
        default: new Error('Op.substring is not compatible with Op.all'),
      });

      // @ts-expect-error -- startsWith is not compatible with Op.any + Op.values
      testSql.skip({ stringAttr: { [Op.substring]: { [Op.any]: { [Op.values]: ['test'] } } } }, {
        default: new Error('Op.substring is not compatible with Op.any'),
      });

      // @ts-expect-error -- startsWith is not compatible with Op.all + Op.values
      testSql.skip({ stringAttr: { [Op.substring]: { [Op.all]: { [Op.values]: ['test'] } } } }, {
        default: new Error('Op.substring is not compatible with Op.all'),
      });
    });

    function describeRegexpSuite(
      operator: typeof Op.regexp | typeof Op.iRegexp | typeof Op.notRegexp | typeof Op.notIRegexp,
      sqlOperator: string,
    ) {
      expectTypeOf<WhereOperators[typeof Op.iRegexp]>().toEqualTypeOf<WhereOperators[typeof Op.regexp]>();
      expectTypeOf<WhereOperators[typeof Op.notRegexp]>().toEqualTypeOf<WhereOperators[typeof Op.regexp]>();
      expectTypeOf<WhereOperators[typeof Op.notIRegexp]>().toEqualTypeOf<WhereOperators[typeof Op.regexp]>();

      describe(`Op.${operator.description}`, () => {
        {
          const ignore: TestModelWhere = { stringAttr: { [Op.regexp]: '^sw.*r$' } };
        }

        testSql({ stringAttr: { [operator]: '^sw.*r$' } }, {
          default: `[stringAttr] ${sqlOperator} '^sw.*r$'`,
        });

        testSql({ stringAttr: { [operator]: '^new\nline$' } }, {
          default: `[stringAttr] ${sqlOperator} '^new\nline$'`,
          mariadb: `\`stringAttr\` ${sqlOperator} '^new\\nline$'`,
          mysql: `\`stringAttr\` ${sqlOperator} '^new\\nline$'`,
        });

        testSequelizeValueMethods(operator, sqlOperator);
        testSupportsAnyAll(operator, sqlOperator, ['^a$', '^b$']);
      });
    }

    if (sequelize.dialect.supports.REGEXP) {
      describeRegexpSuite(Op.regexp, sequelize.dialect.name === 'postgres' ? '~' : 'REGEXP');
      describeRegexpSuite(Op.notRegexp, sequelize.dialect.name === 'postgres' ? '!~' : 'NOT REGEXP');
    }

    if (sequelize.dialect.supports.IREGEXP) {
      describeRegexpSuite(Op.iRegexp, '~*');
      describeRegexpSuite(Op.notIRegexp, '!~*');
    }

    if (sequelize.dialect.supports.TSVECTOR) {
      describe('Op.match', () => {
        testSql({ stringAttr: { [Op.match]: fn('to_tsvector', 'swagger') } }, {
          default: `[stringAttr] @@ to_tsvector('swagger')`,
        });

        testSequelizeValueMethods(Op.match, '@@');
        testSupportsAnyAll(Op.match, '@@', [fn('to_tsvector', 'a'), fn('to_tsvector', 'b')]);
      });
    }

    // TODO: Op.strictLeft, strictRight, noExtendLeft, noExtendRight

    if (dialectSupportsRange()) {
      describe('RANGE', () => {

        testSql({
          range: {
            [Op.contains]: new Date(Date.UTC(2000, 1, 1)),
          },
        }, {
          postgres: '"Timeline"."range" @> \'2000-02-01 00:00:00.000 +00:00\'::timestamptz',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        });

        testSql({
          range: {
            [Op.contains]: [new Date(Date.UTC(2000, 1, 1)), new Date(Date.UTC(2000, 2, 1))],
          },
        }, {
          postgres: '"Timeline"."range" @> \'["2000-02-01 00:00:00.000 +00:00","2000-03-01 00:00:00.000 +00:00")\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        });

        testSql({
          unboundedRange: {
            [Op.contains]: [new Date(Date.UTC(2000, 1, 1)), null],
          },
        }, {
          postgres: '"Timeline"."unboundedRange" @> \'["2000-02-01 00:00:00.000 +00:00",)\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        });

        testSql({
          unboundedRange: {
            [Op.contains]: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
          },
        }, {
          postgres: '"Timeline"."unboundedRange" @> \'[-infinity,infinity)\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        });

        testSql({
          range: {
            [Op.contained]: [new Date(Date.UTC(2000, 1, 1)), new Date(Date.UTC(2000, 2, 1))],
          },
        }, {
          postgres: '"Timeline"."range" <@ \'["2000-02-01 00:00:00.000 +00:00","2000-03-01 00:00:00.000 +00:00")\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        });

        testSql({
          reservedSeats: {
            [Op.overlap]: [1, 4],
          },
        }, {
          postgres: '"Room"."reservedSeats" && \'[1,4)\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        });

        testSql({
          reservedSeats: {
            [Op.adjacent]: [1, 4],
          },
        }, {
          postgres: '"Room"."reservedSeats" -|- \'[1,4)\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        });

        testSql({
          reservedSeats: {
            [Op.strictLeft]: [1, 4],
          },
        }, {
          postgres: '"Room"."reservedSeats" << \'[1,4)\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        });

        testSql({
          reservedSeats: {
            [Op.strictRight]: [1, 4],
          },
        }, {
          postgres: '"Room"."reservedSeats" >> \'[1,4)\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        });

        testSql({
          reservedSeats: {
            [Op.noExtendRight]: [1, 4],
          },
        }, {
          postgres: '"Room"."reservedSeats" &< \'[1,4)\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        });

        testSql({
          reservedSeats: {
            [Op.noExtendLeft]: [1, 4],
          },
        }, {
          postgres: '"Room"."reservedSeats" &> \'[1,4)\'',
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        });
      });
    }

    if (sequelize.dialect.supports.JSON) {
      describe('JSON', () => {
        {
          // @ts-expect-error -- attribute 'doesNotExist' does not exist.
          const ignore: TestModelWhere = { 'doesNotExist.nested': 'value' };
        }

        {
          // @ts-expect-error -- attribute 'doesNotExist' does not exist.
          const ignore: TestModelWhere = { '$doesNotExist$.nested': 'value' };
        }

        testSql({
          'jsonAttr.nested': {
            attribute: 'value',
          },
        }, {
          postgres: `("jsonAttr"#>>'{nested,attribute}') = 'value'`,
        });

        testSql.skip({
          '$jsonAttr$.nested': {
            [Op.eq]: 'value',
          },
        }, {
          postgres: `("jsonAttr"#>>'{nested}') = 'value'`,
        });

        testSql.skip({
          '$jsonAttr$.nested': {
            attribute: 'value',
          },
        }, {
          postgres: `("jsonAttr"#>>'{nested,attribute}') = 'value'`,
        });

        testSql({
          'jsonAttr.nested::STRING': 'value',
        }, {
          postgres: `CAST(("jsonAttr"#>>'{nested}') AS STRING) = 'value'`,
        });

        testSql.skip({
          '$jsonAttr$.nested::STRING': 'value',
        }, {
          postgres: `CAST(("jsonAttr"#>>'{nested}') AS STRING) = 'value'`,
        });

        testSql.skip({
          $jsonAttr$: { nested: 'value' },
        }, {
          postgres: `CAST(("jsonAttr"#>>'{nested}') AS STRING) = 'value'`,
        });

        testSql.skip({
          $jsonAttr$: { 'nested::string': 'value' },
        }, {
          postgres: `CAST(("jsonAttr"#>>'{nested}') AS STRING) = 'value'`,
        });

        testSql({ 'jsonAttr.nested.attribute': 4 }, {
          mariadb: 'CAST(json_unquote(json_extract(`jsonAttr`,\'$.nested.attribute\')) AS DECIMAL) = 4',
          mysql: 'CAST(json_unquote(json_extract(`jsonAttr`,\'$.\\"nested\\".\\"attribute\\"\')) AS DECIMAL) = 4',
          postgres: 'CAST(("jsonAttr"#>>\'{nested,attribute}\') AS DOUBLE PRECISION) = 4',
          sqlite: 'CAST(json_extract(`jsonAttr`,\'$.nested.attribute\') AS DOUBLE PRECISION) = 4',
        });

        // aliases correctly
        testSql.skip({ 'aliasedJsonAttr.nested.attribute': 4 }, {
          mariadb: 'CAST(json_unquote(json_extract(`aliased_json`,\'$.nested.attribute\')) AS DECIMAL) = 4',
          mysql: 'CAST(json_unquote(json_extract(`aliased_json`,\'$.\\"nested\\".\\"attribute\\"\')) AS DECIMAL) = 4',
          postgres: 'CAST(("aliased_json"#>>\'{nested,attribute}\') AS DOUBLE PRECISION) = 4',
          sqlite: 'CAST(json_extract(`aliased_json`,\'$.nested.attribute\') AS DOUBLE PRECISION) = 4',
        });
      });
    }

    if (sequelize.dialect.supports.JSONB) {
      describe('JSONB', () => {

        // @ts-expect-error -- typings for `json` are broken, but `json()` is deprecated
        testSql({ id: { [Op.eq]: json('profile.id') } }, {
          default: '"id" = ("profile"#>>\'{id}\')',
        });

        // @ts-expect-error -- typings for `json` are broken, but `json()` is deprecated
        testSql(json('profile.id', cast('12346-78912', 'text')), {
          postgres: '("profile"#>>\'{id}\') = CAST(\'12346-78912\' AS TEXT)',
          sqlite: 'json_extract(`profile`,\'$.id\') = CAST(\'12346-78912\' AS TEXT)',
          mariadb: 'json_unquote(json_extract(`profile`,\'$.id\')) = CAST(\'12346-78912\' AS CHAR)',
          mysql: 'json_unquote(json_extract(`profile`,\'$.\\"id\\"\')) = CAST(\'12346-78912\' AS CHAR)',
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
          prefix: 'User',
        });

        testSql(json({ profile: { id: '12346-78912', name: 'test' } }), {
          postgres: '("profile"#>>\'{id}\') = \'12346-78912\' AND ("profile"#>>\'{name}\') = \'test\'',
          sqlite: 'json_extract(`profile`,\'$.id\') = \'12346-78912\' AND json_extract(`profile`,\'$.name\') = \'test\'',
          mariadb: 'json_unquote(json_extract(`profile`,\'$.id\')) = \'12346-78912\' AND json_unquote(json_extract(`profile`,\'$.name\')) = \'test\'',
          mysql: 'json_unquote(json_extract(`profile`,\'$.\\"id\\"\')) = \'12346-78912\' AND json_unquote(json_extract(`profile`,\'$.\\"name\\"\')) = \'test\'',
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
          prefix: 'User',
        });

        testSql({
          jsonbAttr: {
            nested: {
              attribute: 'value',
            },
          },
        }, {
          mariadb: 'json_unquote(json_extract(`User`.`jsonbAttr`,\'$.nested.attribute\')) = \'value\'',
          mysql: 'json_unquote(json_extract(`User`.`jsonbAttr`,\'$.\\"nested\\".\\"attribute\\"\')) = \'value\'',
          postgres: '("User"."jsonbAttr"#>>\'{nested,attribute}\') = \'value\'',
          sqlite: 'json_extract(`User`.`jsonbAttr`,\'$.nested.attribute\') = \'value\'',
        }, {
          prefix: 'User',
        });

        testSql({
          jsonbAttr: {
            nested: {
              [Op.in]: [1, 2],
            },
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.nested\')) AS DECIMAL) IN (1, 2)',
          mysql: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.\\"nested\\"\')) AS DECIMAL) IN (1, 2)',
          postgres: 'CAST(("jsonbAttr"#>>\'{nested}\') AS DOUBLE PRECISION) IN (1, 2)',
          sqlite: 'CAST(json_extract(`jsonbAttr`,\'$.nested\') AS DOUBLE PRECISION) IN (1, 2)',
        });

        testSql({
          jsonbAttr: {
            nested: {
              [Op.between]: [1, 2],
            },
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.nested\')) AS DECIMAL) BETWEEN 1 AND 2',
          mysql: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.\\"nested\\"\')) AS DECIMAL) BETWEEN 1 AND 2',
          postgres: 'CAST(("jsonbAttr"#>>\'{nested}\') AS DOUBLE PRECISION) BETWEEN 1 AND 2',
          sqlite: 'CAST(json_extract(`jsonbAttr`,\'$.nested\') AS DOUBLE PRECISION) BETWEEN 1 AND 2',
        });

        testSql({
          jsonbAttr: {
            nested: {
              attribute: 'value',
              prop: {
                [Op.ne]: 'None',
              },
            },
          },
        }, {
          mariadb: '(json_unquote(json_extract(`User`.`jsonbAttr`,\'$.nested.attribute\')) = \'value\' AND json_unquote(json_extract(`User`.`jsonbAttr`,\'$.nested.prop\')) != \'None\')',
          mysql: '(json_unquote(json_extract(`User`.`jsonbAttr`,\'$.\\"nested\\".\\"attribute\\"\')) = \'value\' AND json_unquote(json_extract(`User`.`jsonbAttr`,\'$.\\"nested\\".\\"prop\\"\')) != \'None\')',
          postgres: '(("User"."jsonbAttr"#>>\'{nested,attribute}\') = \'value\' AND ("User"."jsonbAttr"#>>\'{nested,prop}\') != \'None\')',
          sqlite: '(json_extract(`User`.`jsonbAttr`,\'$.nested.attribute\') = \'value\' AND json_extract(`User`.`jsonbAttr`,\'$.nested.prop\') != \'None\')',
        }, {
          prefix: literal(sql.quoteTable.call(sequelize.dialect.queryGenerator, { tableName: 'User' })),
        });

        testSql({
          jsonbAttr: {
            name: {
              last: 'Simpson',
            },
            employment: {
              [Op.ne]: 'None',
            },
          },
        }, {
          mariadb: '(json_unquote(json_extract(`User`.`jsonbAttr`,\'$.name.last\')) = \'Simpson\' AND json_unquote(json_extract(`User`.`jsonbAttr`,\'$.employment\')) != \'None\')',
          mysql: '(json_unquote(json_extract(`User`.`jsonbAttr`,\'$.\\"name\\".\\"last\\"\')) = \'Simpson\' AND json_unquote(json_extract(`User`.`jsonbAttr`,\'$.\\"employment\\"\')) != \'None\')',
          postgres: '(("User"."jsonbAttr"#>>\'{name,last}\') = \'Simpson\' AND ("User"."jsonbAttr"#>>\'{employment}\') != \'None\')',
          sqlite: '(json_extract(`User`.`jsonbAttr`,\'$.name.last\') = \'Simpson\' AND json_extract(`User`.`jsonbAttr`,\'$.employment\') != \'None\')',
        }, {
          prefix: 'User',
        });

        testSql({
          jsonbAttr: {
            price: 5,
            name: 'Product',
          },
        }, {
          mariadb: '(CAST(json_unquote(json_extract(`jsonbAttr`,\'$.price\')) AS DECIMAL) = 5 AND json_unquote(json_extract(`jsonbAttr`,\'$.name\')) = \'Product\')',
          mysql: '(CAST(json_unquote(json_extract(`jsonbAttr`,\'$.\\"price\\"\')) AS DECIMAL) = 5 AND json_unquote(json_extract(`jsonbAttr`,\'$.\\"name\\"\')) = \'Product\')',
          postgres: '(CAST(("jsonbAttr"#>>\'{price}\') AS DOUBLE PRECISION) = 5 AND ("jsonbAttr"#>>\'{name}\') = \'Product\')',
          sqlite: '(CAST(json_extract(`jsonbAttr`,\'$.price\') AS DOUBLE PRECISION) = 5 AND json_extract(`jsonbAttr`,\'$.name\') = \'Product\')',
        });

        testSql({
          'jsonbAttr.nested.attribute': {
            [Op.in]: [3, 7],
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.nested.attribute\')) AS DECIMAL) IN (3, 7)',
          mysql: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.\\"nested\\".\\"attribute\\"\')) AS DECIMAL) IN (3, 7)',
          postgres: 'CAST(("jsonbAttr"#>>\'{nested,attribute}\') AS DOUBLE PRECISION) IN (3, 7)',
          sqlite: 'CAST(json_extract(`jsonbAttr`,\'$.nested.attribute\') AS DOUBLE PRECISION) IN (3, 7)',
        });

        testSql({
          jsonbAttr: {
            nested: {
              attribute: {
                [Op.gt]: 2,
              },
            },
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.nested.attribute\')) AS DECIMAL) > 2',
          mysql: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.\\"nested\\".\\"attribute\\"\')) AS DECIMAL) > 2',
          postgres: 'CAST(("jsonbAttr"#>>\'{nested,attribute}\') AS DOUBLE PRECISION) > 2',
          sqlite: 'CAST(json_extract(`jsonbAttr`,\'$.nested.attribute\') AS DOUBLE PRECISION) > 2',
        });

        testSql({
          jsonbAttr: {
            nested: {
              'attribute::integer': {
                [Op.gt]: 2,
              },
            },
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.nested.attribute\')) AS DECIMAL) > 2',
          mysql: 'CAST(json_unquote(json_extract(`jsonbAttr`,\'$.\\"nested\\".\\"attribute\\"\')) AS DECIMAL) > 2',
          postgres: 'CAST(("jsonbAttr"#>>\'{nested,attribute}\') AS INTEGER) > 2',
          sqlite: 'CAST(json_extract(`jsonbAttr`,\'$.nested.attribute\') AS INTEGER) > 2',
        });

        const dt = new Date();
        testSql({
          jsonbAttr: {
            nested: {
              attribute: {
                [Op.gt]: dt,
              },
            },
          },
        }, {
          mariadb: `CAST(json_unquote(json_extract(\`jsonbAttr\`,'$.nested.attribute')) AS DATETIME) > ${sql.escape(dt)}`,
          mysql: `CAST(json_unquote(json_extract(\`jsonbAttr\`,'$.\\"nested\\".\\"attribute\\"')) AS DATETIME) > ${sql.escape(dt)}`,
          postgres: `CAST(("jsonbAttr"#>>'{nested,attribute}') AS TIMESTAMPTZ) > ${sql.escape(dt)}`,
          sqlite: `json_extract(\`jsonbAttr\`,'$.nested.attribute') > ${sql.escape(dt.toISOString())}`,
        });

        testSql({
          jsonbAttr: {
            nested: {
              attribute: true,
            },
          },
        }, {
          mariadb: 'json_unquote(json_extract(`jsonbAttr`,\'$.nested.attribute\')) = \'true\'',
          mysql: 'json_unquote(json_extract(`jsonbAttr`,\'$.\\"nested\\".\\"attribute\\"\')) = \'true\'',
          postgres: 'CAST(("jsonbAttr"#>>\'{nested,attribute}\') AS BOOLEAN) = true',
          sqlite: 'CAST(json_extract(`jsonbAttr`,\'$.nested.attribute\') AS BOOLEAN) = 1',
        });

        testSql({ 'jsonbAttr.nested.attribute': 'value' }, {
          mariadb: 'json_unquote(json_extract(`jsonbAttr`,\'$.nested.attribute\')) = \'value\'',
          mysql: 'json_unquote(json_extract(`jsonbAttr`,\'$.\\"nested\\".\\"attribute\\"\')) = \'value\'',
          postgres: '("jsonbAttr"#>>\'{nested,attribute}\') = \'value\'',
          sqlite: 'json_extract(`jsonbAttr`,\'$.nested.attribute\') = \'value\'',
        });

        testSql({
          jsonbAttr: {
            [Op.contains]: { company: 'Magnafone' },
          },
        }, {
          default: '[jsonbAttr] @> \'{"company":"Magnafone"}\'',
        });

        // aliases correctly

        testSql.skip({ aliasedJsonbAttr: { key: 'value' } }, {
          mariadb: 'json_unquote(json_extract(`aliased_jsonb`,\'$.key\')) = \'value\'',
          mysql: 'json_unquote(json_extract(`aliased_jsonb`,\'$.\\"key\\"\')) = \'value\'',
          postgres: '("aliased_jsonb"#>>\'{key}\') = \'value\'',
          sqlite: 'json_extract(`aliased_jsonb`,\'$.key\') = \'value\'',
        });
      });
    }

    testSql({
      stringAttr: 'a project',
      [Op.or]: [
        { intAttr1: [1, 2, 3] },
        { intAttr1: { [Op.gt]: 10 } },
      ],
    }, {
      default: '([intAttr1] IN (1, 2, 3) OR [intAttr1] > 10) AND [stringAttr] = \'a project\'',
      mssql: '([intAttr1] IN (1, 2, 3) OR [intAttr1] > 10) AND [stringAttr] = N\'a project\'',
    });

    describe('where()', () => {
      testSql(where(fn('lower', col('name')), null), {
        default: 'lower([name]) IS NULL',
      });

      {
        // @ts-expect-error -- 'intAttr1' is not a boolean and cannot be compared to the output of 'where'
        const ignore: TestModelWhere = { intAttr1: where(fn('lower', col('name')), null) };
      }

      testSql.skip({ booleanAttr: where(fn('lower', col('name')), null) }, {
        default: `[booleanAttr] = (lower([name]) IS NULL)`,
      });

      testSql(where(fn('SUM', col('hours')), '>', 0), {
        default: 'SUM([hours]) > 0',
      });

      testSql(where(fn('SUM', col('hours')), Op.gt, 0), {
        default: 'SUM([hours]) > 0',
      });

      testSql(where(fn('lower', col('name')), Op.ne, null), {
        default: 'lower([name]) IS NOT NULL',
      });

      testSql(where(fn('lower', col('name')), Op.not, null), {
        default: 'lower([name]) IS NOT NULL',
      });

      testSql([where(fn('SUM', col('hours')), Op.gt, 0),
        where(fn('lower', col('name')), null)], {
        default: '(SUM([hours]) > 0 AND lower([name]) IS NULL)',
      });

      testSql(where(col('hours'), Op.between, [0, 5]), {
        default: '[hours] BETWEEN 0 AND 5',
      });

      testSql(where(col('hours'), Op.notBetween, [0, 5]), {
        default: '[hours] NOT BETWEEN 0 AND 5',
      });

      testSql(where(literal(`'hours'`), Op.eq, 'hours'), {
        default: `'hours' = 'hours'`,
        mssql: `'hours' = N'hours'`,
      });

      testSql(where(TestModel.getAttributes().intAttr1, Op.eq, 1), {
        default: '[TestModel].[intAttr1] = 1',
      });

      // TODO - v7
      // testSql.skip(where(1, 1), {
      //   default: new Error('The operator must be specified when comparing two literals in where()'),
      // });
      //
      // testSql.skip(where(1, Op.eq, 1), {
      //   default: '1 = 1',
      // });
      //
      // testSql.skip(where(1, Op.eq, col('col')), {
      //   default: '1 = [col]',
      // });
      //
      // testSql.skip(where('string', Op.eq, col('col')), {
      //   default: `'string' = [col]`,
      // });
    });
  });

  describe('whereItemQuery', () => {
    function testSql(key: string | undefined, value, options, expectation) {
      if (expectation === undefined) {
        expectation = options;
        options = undefined;
      }

      it(`${String(key)}: ${util.inspect(value, { depth: 10 })}${options && `, ${util.inspect(options)}` || ''}`, () => {
        return expectsql(sql.whereItemQuery(key, value, options), expectation);
      });
    }

    testSql(undefined, 'lol=1', {
      default: 'lol=1',
    });

    describe('Op.and/Op.or/Op.not', () => {
      describe('Op.or', () => {
        testSql('email', {
          [Op.or]: ['maker@mhansen.io', 'janzeh@gmail.com'],
        }, {
          default: '([email] = \'maker@mhansen.io\' OR [email] = \'janzeh@gmail.com\')',
          mssql: '([email] = N\'maker@mhansen.io\' OR [email] = N\'janzeh@gmail.com\')',
        });

        testSql('rank', {
          [Op.or]: {
            [Op.lt]: 100,
            [Op.eq]: null,
          },
        }, {
          default: '([rank] < 100 OR [rank] IS NULL)',
        });

        testSql(Op.or, [
          { email: 'maker@mhansen.io' },
          { email: 'janzeh@gmail.com' },
        ], {
          default: '([email] = \'maker@mhansen.io\' OR [email] = \'janzeh@gmail.com\')',
          mssql: '([email] = N\'maker@mhansen.io\' OR [email] = N\'janzeh@gmail.com\')',
        });

        testSql(Op.or, {
          email: 'maker@mhansen.io',
          name: 'Mick Hansen',
        }, {
          default: '([email] = \'maker@mhansen.io\' OR [name] = \'Mick Hansen\')',
          mssql: '([email] = N\'maker@mhansen.io\' OR [name] = N\'Mick Hansen\')',
        });

        testSql(Op.or, {
          equipment: [1, 3],
          muscles: {
            [Op.in]: [2, 4],
          },
        }, {
          default: '([equipment] IN (1, 3) OR [muscles] IN (2, 4))',
        });

        testSql(Op.or, [
          {
            roleName: 'NEW',
          }, {
            roleName: 'CLIENT',
            type: 'CLIENT',
          },
        ], {
          default: '([roleName] = \'NEW\' OR ([roleName] = \'CLIENT\' AND [type] = \'CLIENT\'))',
          mssql: '([roleName] = N\'NEW\' OR ([roleName] = N\'CLIENT\' AND [type] = N\'CLIENT\'))',
        });

        it('or({group_id: 1}, {user_id: 2})', () => {
          expectsql(sql.whereItemQuery(undefined, or({ group_id: 1 }, { user_id: 2 })), {
            default: '([group_id] = 1 OR [user_id] = 2)',
          });
        });

        it('or({group_id: 1}, {user_id: 2, role: \'admin\'})', () => {
          expectsql(sql.whereItemQuery(undefined, or({ group_id: 1 }, { user_id: 2, role: 'admin' })), {
            default: '([group_id] = 1 OR ([user_id] = 2 AND [role] = \'admin\'))',
            mssql: '([group_id] = 1 OR ([user_id] = 2 AND [role] = N\'admin\'))',
          });
        });

        testSql(Op.or, [], {
          default: '0 = 1',
        });

        testSql(Op.or, {}, {
          default: '0 = 1',
        });

        it('or()', () => {
          expectsql(sql.whereItemQuery(undefined, or()), {
            default: '0 = 1',
          });
        });
      });

      describe('Op.and', () => {
        testSql(Op.and, {
          [Op.or]: {
            group_id: 1,
            user_id: 2,
          },
          shared: 1,
        }, {
          default: '(([group_id] = 1 OR [user_id] = 2) AND [shared] = 1)',
        });

        testSql(Op.and, [
          {
            name: {
              [Op.like]: '%hello',
            },
          },
          {
            name: {
              [Op.like]: 'hello%',
            },
          },
        ], {
          default: '([name] LIKE \'%hello\' AND [name] LIKE \'hello%\')',
          mssql: '([name] LIKE N\'%hello\' AND [name] LIKE N\'hello%\')',
        });

        testSql('rank', {
          [Op.and]: {
            [Op.ne]: 15,
            [Op.between]: [10, 20],
          },
        }, {
          default: '([rank] != 15 AND [rank] BETWEEN 10 AND 20)',
        });

        testSql('name', {
          [Op.and]: [
            { [Op.like]: '%someValue1%' },
            { [Op.like]: '%someValue2%' },
          ],
        }, {
          default: '([name] LIKE \'%someValue1%\' AND [name] LIKE \'%someValue2%\')',
          mssql: '([name] LIKE N\'%someValue1%\' AND [name] LIKE N\'%someValue2%\')',
        });

        it('and({shared: 1, or({group_id: 1}, {user_id: 2}))', () => {
          expectsql(sql.whereItemQuery(undefined, and({ shared: 1 }, or({ group_id: 1 }, { user_id: 2 }))), {
            default: '([shared] = 1 AND ([group_id] = 1 OR [user_id] = 2))',
          });
        });
      });

      describe('Op.not', () => {
        testSql(Op.not, {
          [Op.or]: {
            group_id: 1,
            user_id: 2,
          },
          shared: 1,
        }, {
          default: 'NOT (([group_id] = 1 OR [user_id] = 2) AND [shared] = 1)',
        });
      });
    });

    describe('Op.col', () => {
      testSql('$organization.id$', {
        [Op.col]: 'user.organizationId',
      }, {
        default: '[organization].[id] = [user].[organizationId]',
      });

      testSql('$offer.organization.id$', {
        [Op.col]: 'offer.user.organizationId',
      }, {
        default: '[offer->organization].[id] = [offer->user].[organizationId]',
      });
    });

    describe('fn', () => {
      it('{name: fn(\'LOWER\', \'DERP\')}', () => {
        expectsql(sql.whereQuery({ name: fn('LOWER', 'DERP') }), {
          default: 'WHERE [name] = LOWER(\'DERP\')',
          mssql: 'WHERE [name] = LOWER(N\'DERP\')',
        });
      });
    });
  });
});
