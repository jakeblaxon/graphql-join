import {mergeSchemas} from '@graphql-tools/merge';
import {wrapSchema} from '@graphql-tools/wrap';
import {execute, parse} from 'graphql';
import {productSchema} from './fixtures/products';
import {reviewSchema} from './fixtures/reviews';
import GraphQLJoin from '../src';

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
        extend type Product {
          reviews: [Review!]!
        }
      `,
      resolvers: {
        Review: {
          product: 'getProductsById(ids: $productId) { productId: upc }',
        },
        Product: {
          reviews: 'getReviewsByProductId(productIds: $upc) { upc: productId }',
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
            product {
              name
              price
              weight
              reviews {
                  id
                  body
              }
            }
          }
        }
      `)
    );
    expect(result).toEqual({
      data: {
        getReviewsById: [
          {
            id: '1',
            body: 'Love it!',
            product: {
              name: 'Table',
              price: 899,
              weight: 100,
              reviews: [
                {
                  id: '1',
                  body: 'Love it!',
                },
                {
                  id: '4',
                  body: 'Prefer something else.',
                },
              ],
            },
          },
          {
            id: '2',
            body: 'Too expensive.',
            product: {
              name: 'Couch',
              price: 1299,
              weight: 1000,
              reviews: [
                {
                  id: '2',
                  body: 'Too expensive.',
                },
              ],
            },
          },
          {
            id: '3',
            body: 'Could be better.',
            product: {
              name: 'Chair',
              price: 54,
              weight: 50,
              reviews: [
                {
                  id: '3',
                  body: 'Could be better.',
                },
              ],
            },
          },
          {
            id: '4',
            body: 'Prefer something else.',
            product: {
              name: 'Table',
              price: 899,
              weight: 100,
              reviews: [
                {
                  id: '1',
                  body: 'Love it!',
                },
                {
                  id: '4',
                  body: 'Prefer something else.',
                },
              ],
            },
          },
        ],
      },
    });
  });
});
