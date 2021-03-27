import {makeExecutableSchema} from '@graphql-tools/schema';
import {validateFieldConfig} from '../src/validate';

const schema = makeExecutableSchema({
  typeDefs: `#graphql
  type Query {
    getProductsById(ids: [String!]!): [Product!]!
    getReviewsById(ids: [ID!]!): [Review!]!
    getReviewsByProductId(productIds: [String!]!): [Review!]!
  }

  type Product {
    upc: String!
    name: String
    price: Int
    weight: Int
  }

  type Review {
    id: ID!
    body: String
    productId: String!
  }
`,
});

describe('validateFieldConfig', () => {
  it('rejects invalid sdl', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId() { upc: productId }',
        'Product',
        'reviews',
        '',
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Syntax Error: Expected Name, found ")".'
    );
  });

  it('rejects queries wrapped in operation definitions', () => {
    expect(() =>
      validateFieldConfig(
        '{ getReviewsByProductId(productIds: $upc) { upc: productId } }',
        'Product',
        'reviews',
        '',
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Syntax Error: Expected Name, found "{".'
    );
    expect(() =>
      validateFieldConfig(
        'query { getReviewsByProductId(productIds: $upc) { upc: productId } }',
        'Product',
        'reviews',
        '',
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Cannot query field "query" on type "Query"'
    );
    expect(() =>
      validateFieldConfig(
        'query testQuery { getReviewsByProductId(productIds: $upc) { upc: productId } }',
        'Product',
        'reviews',
        '',
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Only one query field is allowed.'
    );
  });
});
