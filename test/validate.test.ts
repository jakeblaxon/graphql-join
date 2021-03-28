import {makeExecutableSchema} from '@graphql-tools/schema';
import {validateFieldConfig} from '../src/validate';

const schema = makeExecutableSchema({
  typeDefs: `#graphql
    type Query {
      getReviewsByProductId(productIds: [String!]!): [Review!]!
      getUsersByName(names: [String]): [User]
    }
    type Product {
      upc: String!
      name: String
      price: Int
    }
    type Review {
      id: Int!
      body: String
      productId: String!
    }
    type User {
      name: String
    }
  `,
});

const typeDefs = `#graphql
  extend type Product {
    reviews: [Review!]!
  }
`;

describe('validateFieldConfig', () => {
  it('rejects invalid sdl', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId() { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
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
        typeDefs,
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
        typeDefs,
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
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Multiple queries or fragments are not allowed.'
    );
  });

  it('rejects mltiple queries', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productId } getUsersByName(names: $upc) { upc: name }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Multiple queries or fragments are not allowed.'
    );
  });

  it('rejects unknown query names', () => {
    expect(() =>
      validateFieldConfig(
        'unknownQueryName(productIds: $upc) { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Cannot query field "unknownQueryName" on type "Query"'
    );
  });

  it('rejects invalid input types', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc, all: true) { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Unknown argument "all" on field "Query.getReviewsByProductId".'
    );
  });

  it('rejects query variables with no corresponding field name', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upcs) { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Field corresponding to $upcs not found in type Product.'
    );
  });

  it('rejects query variables whose corresponding field type mismatches with the input type', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $price) { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Variable "$price" of type "[Int!]!" used in position expecting type "[String!]!".'
    );
  });

  it('rejects query with missing selection set', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc)',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Field "getReviewsByProductId" of type "[Review!]!" must have a selection of subfields. ' +
        'Did you mean "getReviewsByProductId { ... }"?'
    );
  });

  it('rejects unknown selection fields', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Cannot query field "upc" on type "Review".'
    );
  });

  it('rejects selection fields with no corresponding field in the parent type', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Field corresponding to [productId] in selection set not found in type [Product]. ' +
        'Use an alias to map the child field to the corresponding parent field.'
    );
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upcs: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Field corresponding to [upcs] in selection set not found in type [Product]. ' +
        'Make sure the alias is correctly spelled.'
    );
  });

  it('rejects selection fields whose corresponding parent field type mismatches with the child field type', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { price: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Cannot join on keys [Product.price] and [Review.productId]. ' +
        'They are different types: Int and String.'
    );
  });

  // TODO implement feature
  it.skip('allows ID type to map to String', () => {
    const schema = makeExecutableSchema({
      typeDefs: `#graphql
        type Query {
          getReviewsByProductId(productIds: [String!]!): [Review!]!
        }
        type Product {
          upc: ID!
        }
        type Review {
          productId: String
        }
      `,
    });
    const typeDefs = `#graphql
      extend type Product {
        reviews: [Review]
      }
    `;
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).not.toThrow();
  });

  it('rejects selection fields that are not scalars or scalar lists', () => {
    const schema = makeExecutableSchema({
      typeDefs: `#graphql
        type Query {
          getReviewsByProductId(productIds: [String!]!): [Review!]!
        }
        type Product {
          upc: String!
          productIdWrapper: ProductIdWrapper
        }
        type Review {
          productId: String
          productIdWrapper: ProductIdWrapper
        }
        type ProductIdWrapper {
          id: String
        }
      `,
    });
    const typeDefs = `#graphql
      extend type Product {
        reviews: [Review]
      }
    `;
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productIdWrapper { id } }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Cannot join on key [Review.productIdWrapper]. Join keys must be scalars or scalar lists.'
    );
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { productIdWrapper: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Cannot join on keys [Product.productIdWrapper] and [Review.productId]. ' +
        'They are different types: ProductIdWrapper and String.'
    );
  });

  it('allows custom scalar types', () => {
    const schema = makeExecutableSchema({
      typeDefs: `#graphql
        type Query {
          getReviewsByProductId(productIds: [BigInt!]!): [Review!]!
        }
        type Product {
          upc: BigInt!
        }
        type Review {
          productId: BigInt
        }
        scalar BigInt
      `,
    });
    const typeDefs = `#graphql
      extend type Product {
        reviews: [Review]
      }
    `;
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).not.toThrow();
  });

  it('rejects query with non-object return type (when unwrapped)', () => {
    const schema = makeExecutableSchema({
      typeDefs: `#graphql
        type Query {
          getScalarList: [String]!
        }
        type Product {
          upc: String!
        }
      `,
    });
    const typeDefs = `#graphql
      extend type Product {
        strings: [String]
      }
    `;
    expect(() =>
      validateFieldConfig(
        'getScalarList',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Query must return an object or list of objects but instead returns [String]!.'
    );
  });

  it('rejects when the unwrapped query return type does not match the intended type', () => {
    expect(() =>
      validateFieldConfig(
        'getUsersByName(names: $upc) { upc: name }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Query does not return the intended entity type Review for [Product.reviews]. Returns [User].'
    );
  });

  it('rejects queries with fragments', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { ...ReviewFragment } fragment ReviewFragment on Review { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Multiple queries or fragments are not allowed.'
    );
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { ...on Review { upc: productId } }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: Fragments are not allowed in query.'
    );
  });

  it('rejects invalid typeDefs sdl', () => {
    const typeDefs = `#graphql
      extend type Product {}
    `;
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver [Product.reviews]: typeDefs is invalid: Syntax Error: Expected Name, found "}".'
    );
  });

  it('accepts valid configurations', () => {
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).not.toThrow();
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productId, price: id }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).not.toThrow();
  });
});