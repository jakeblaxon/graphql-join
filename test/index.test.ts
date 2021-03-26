import {makeExecutableSchema} from '@graphql-tools/schema';
import {wrapSchema} from '@graphql-tools/wrap';
import {execute, parse} from 'graphql';
import {addChildKeyFieldsToSelectionSetTransform} from '../src';

describe('addChildKeyFieldsToSelectionSetTransform', () => {
  const schema = makeExecutableSchema({
    typeDefs: `#graphql
        type Query {
            me: User
        }

        type User {
            id: Int!
            name: String
        }
    `,
    resolvers: {
      Query: {
        me: (a, b, c, info) => {
          console.log(JSON.stringify(info, null, 2));
          return {id: 1, name: 'Blake'};
        },
      },
    },
  });

  it('should add a new single key field', () => {
    const result = execute(
      wrapSchema({
        schema,
        transforms: [addChildKeyFieldsToSelectionSetTransform('me', ['id'])],
      }),
      parse(`#graphql
        {
          me {
            name
          }
        }
      `)
    );
    console.log(result);
  });
});
