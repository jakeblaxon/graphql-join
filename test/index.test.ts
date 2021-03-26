import {mergeSchemas} from '@graphql-tools/merge';
import {wrapSchema} from '@graphql-tools/wrap';
import {execute, parse} from 'graphql';
import GraphQLJoin from '../src';
import {productSchema} from './fixtures/products';
import {reviewSchema} from './fixtures/reviews';

const mergedSchema = mergeSchemas({
  schemas: [productSchema, reviewSchema],
});

describe('GraphQLJoin', () => {
  it('works', async () => {
    const graphqlJoinTransform = new GraphQLJoin({
      typeDefs: `#graphql
        extend type Review {
          product: Product
        }
      `,
      resolvers: {
        Review: {
          product: `#graphql
            getProductsById(ids: $productId) { productId: upc }
          `,
        },
      },
    });
    const schema = wrapSchema({
      schema: mergedSchema,
      transforms: [graphqlJoinTransform],
    });
    const result = await execute(
      schema,
      parse(`#graphql
        {
          getReviewsById(ids: ["1", "2", "3", "4"]) {
            id
            body
            productId
            product {
              upc
              name
              price
              weight
            }
          }
        }
      `)
    );
    console.log(JSON.stringify(result, null, 2));
  });
});
