import {
  list,
  makeSchema,
  nonNull,
  objectType,
  queryType,
  stringArg,
} from 'nexus';
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
      'graphql-join config error for resolver "Product.reviews": Syntax Error: Expected Name, found ")".'
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
      'graphql-join config error for resolver "Product.reviews": Syntax Error: Expected Name, found "{".'
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
      'graphql-join config error for resolver "Product.reviews": Cannot query field "query" on type "Query"'
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
      'graphql-join config error for resolver "Product.reviews": Multiple queries or fragments are not allowed.'
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
      'graphql-join config error for resolver "Product.reviews": Multiple queries or fragments are not allowed.'
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
      'graphql-join config error for resolver "Product.reviews": Cannot query field "unknownQueryName" on type "Query"'
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
      'graphql-join config error for resolver "Product.reviews": Unknown argument "all" on field "Query.getReviewsByProductId".'
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
      'graphql-join config error for resolver "Product.reviews": Field corresponding to "$upcs" not found in type "Product".'
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
      'graphql-join config error for resolver "Product.reviews": Variable "$price" of type "[Int!]!" used in position expecting type "[String!]!".'
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
      'graphql-join config error for resolver "Product.reviews": Field "getReviewsByProductId" of type "[Review!]!" must have a selection of subfields. ' +
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
      'graphql-join config error for resolver "Product.reviews": Cannot query field "upc" on type "Review".'
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
      'graphql-join config error for resolver "Product.reviews": Field corresponding to "productId" in selection set not found in type "Product". ' +
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
      'graphql-join config error for resolver "Product.reviews": Field corresponding to "upcs" in selection set not found in type "Product". ' +
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
      'graphql-join config error for resolver "Product.reviews": Cannot join on keys "Product.price" and "Review.productId". ' +
        'They are different types: "Int" and "String".'
    );
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
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productIdWrapper { id } }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver "Product.reviews": Cannot join on key "Review.productIdWrapper". Join keys must be scalars or scalar lists.'
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
      'graphql-join config error for resolver "Product.reviews": Cannot join on keys "Product.productIdWrapper" and "Review.productId". ' +
        'They are different types: "ProductIdWrapper" and "String".'
    );
  });

  it('only allows a single selection field when its corresponding parent or child field is a list', () => {
    const schema = makeExecutableSchema({
      typeDefs: `#graphql
        type Query {
          getReviewsByProductId(productIds: [String!]!): [Review!]!
        }
        type Product {
          upc: String!
          name: String
          reviewIds: [String]
        }
        type Review {
          id: String!
          name: String
          productIds: [String]
        }
      `,
    });
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productIds }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).not.toThrow();
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { upc: productIds, name }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver "Product.reviews": Only one selection field is allowed when joining on a list type like "Review.productIds".'
    );
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { reviewIds: id }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).not.toThrow();
    expect(() =>
      validateFieldConfig(
        'getReviewsByProductId(productIds: $upc) { reviewIds: id, name }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver "Product.reviews": Only one selection field is allowed when joining on a list type like "Product.reviewIds".'
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

  it('rejects query whose return type is not a list', () => {
    const schema = makeExecutableSchema({
      typeDefs: `#graphql
        type Query {
          getReview: Review!
        }
        type Product {
          upc: String!
        }
        type Review {
          id: String!
          productId: String
        }
      `,
    });
    expect(() =>
      validateFieldConfig(
        'getReview { upc: productId }',
        'Product',
        'reviews',
        typeDefs,
        schema
      )
    ).toThrow(
      'graphql-join config error for resolver "Product.reviews": Query must return a list of objects but instead returns "Review!".'
    );
  });

  it('rejects query with non-object return type when unwrapped', () => {
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
        reviews: [String]
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
      'graphql-join config error for resolver "Product.reviews": Query must return a list of objects but instead returns "[String]!".'
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
      'graphql-join config error for resolver "Product.reviews": ' +
        'Query does not return the intended entity type "Review" for "Product.reviews". Returns "[User]".'
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
      'graphql-join config error for resolver "Product.reviews": Multiple queries or fragments are not allowed.'
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
      'graphql-join config error for resolver "Product.reviews": Fragments are not allowed in query.'
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
      'graphql-join config error for resolver "Product.reviews": typeDefs is invalid: Syntax Error: Expected Name, found "}".'
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

  it('works with schemas with null ast nodes', () => {
    const Product = objectType({
      name: 'Product',
      definition(t) {
        t.nonNull.string('upc');
        t.string('name');
        t.int('price');
      },
    });
    const Review = objectType({
      name: 'Review',
      definition(t) {
        t.nonNull.int('id');
        t.string('body');
        t.nonNull.string('productId');
      },
    });
    const Query = queryType({
      definition(t) {
        t.field('getReviewsByProductId', {
          type: nonNull(list(nonNull(Review))),
          args: {
            productIds: nonNull(list(nonNull(stringArg()))),
          },
        });
      },
    });
    const schema = makeSchema({
      types: [Product, Review, Query],
    });
    expect(schema.getType('Product')?.astNode).toBeUndefined();
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

  describe('unbatched queries', () => {
    it('warns against using unbatched queries', () => {
      const consoleSpy = spyOn(console, 'warn');
      validateFieldConfig(
        'getReviewsByProductId(productIds: [$upc]) @unbatched',
        'Product',
        'reviews',
        typeDefs,
        schema
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'graphql-join warning for resolver "Product.reviews": Use of unbatched queries is not recommended as it results in the n+1 problem.'
      );
    });

    it('accepts query with missing selection set when marked with @unbatched directive', () => {
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId(productIds: [$upc]) @unbatched',
          'Product',
          'reviews',
          typeDefs,
          schema
        )
      ).not.toThrow();
    });

    it('rejects query with both @unbatched directive and a selection set', () => {
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId(productIds: [$upc]) @unbatched { upc: productId }',
          'Product',
          'reviews',
          typeDefs,
          schema
        )
      ).toThrow(
        'graphql-join config error for resolver "Product.reviews": Selection sets for unbatched queries are unnecessary.'
      );
    });

    const scalarSchema = makeExecutableSchema({
      typeDefs: `#graphql
        type Query {
          getReviewByProductId(productId: String!): String
          getReviewsByProductId(productId: String!): [String]
        }
        type Product {
          upc: String!
          name: String
          price: Int
        }
      `,
    });

    it('allows scalar and scalar list return types', () => {
      const typeDefs = `#graphql
        extend type Product {
          review: String
          reviews: [String]
        }
      `;
      expect(() =>
        validateFieldConfig(
          'getReviewByProductId(productId: $upc) @unbatched',
          'Product',
          'review',
          typeDefs,
          scalarSchema
        )
      ).not.toThrow();
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId(productId: $upc) @unbatched',
          'Product',
          'reviews',
          typeDefs,
          scalarSchema
        )
      ).not.toThrow();
    });

    it('enforces that the unwrapped return type matches unwrapped expected type', () => {
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId(productId: $upc) @unbatched',
          'Product',
          'reviews',
          typeDefs,
          scalarSchema
        )
      ).toThrow(
        'graphql-join config error for resolver "Product.reviews": ' +
          'Query does not return the intended type "[Review!]!" for "Product.reviews". Returns "[String]".'
      );
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId(productIds: [$upc]) @unbatched',
          'Product',
          'reviews',
          typeDefs,
          schema
        )
      ).not.toThrow();
    });

    const nullableSchema = makeExecutableSchema({
      typeDefs: `#graphql
        type Query {
          getReviewByProductId_NonNullable(productId: String!): Review!
          getReviewsByProductId_Nullable(productIds: [String!]!): [Review]
          getReviewsByProductId_NonNullable(productIds: [String!]!): [Review!]!
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
      `,
    });

    it('enforces that if expected type is singular, then return type must be singular', () => {
      const typeDefs = `#graphql
        extend type Product {
          review: Review
        }
      `;
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId_NonNullable(productIds: [$upc]) @unbatched',
          'Product',
          'review',
          typeDefs,
          nullableSchema
        )
      ).toThrow(
        'graphql-join config error for resolver "Product.review": ' +
          'Query does not return the intended type "Review" for "Product.review". Returns "[Review!]!".'
      );
      expect(() =>
        validateFieldConfig(
          'getReviewByProductId_NonNullable(productId: $upc) @unbatched',
          'Product',
          'review',
          typeDefs,
          nullableSchema
        )
      ).not.toThrow();
    });

    it('enforces that if expected type is a list, then return type must be a list', () => {
      const typeDefs = `#graphql
        extend type Product {
          reviews: [Review]
        }
      `;
      expect(() =>
        validateFieldConfig(
          'getReviewByProductId_NonNullable(productId: $upc) @unbatched',
          'Product',
          'reviews',
          typeDefs,
          nullableSchema
        )
      ).toThrow(
        'graphql-join config error for resolver "Product.reviews": ' +
          'Query does not return the intended type "[Review]" for "Product.reviews". Returns "Review!".'
      );
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId_NonNullable(productIds: [$upc]) @unbatched',
          'Product',
          'reviews',
          typeDefs,
          nullableSchema
        )
      ).not.toThrow();
    });

    it('enforces that return type is the same as or a stricter subset of the intended type', () => {
      const typeDefs = `#graphql
        extend type Product {
          reviews_Nullable_All: [Review!]
          reviews_Nullable_Outer: [Review!]
          reviews_Nullable_Inner: [Review]!
          reviews_NonNullable: [Review!]!
        }
      `;
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId_Nullable(productIds: [$upc]) @unbatched',
          'Product',
          'reviews_NonNullable',
          typeDefs,
          nullableSchema
        )
      ).toThrow(
        'graphql-join config error for resolver "Product.reviews_NonNullable": ' +
          'Query does not return the intended type "[Review!]!" for "Product.reviews_NonNullable". Returns "[Review]".'
      );
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId_Nullable(productIds: [$upc]) @unbatched',
          'Product',
          'reviews_Nullable_Outer',
          typeDefs,
          nullableSchema
        )
      ).toThrow(
        'graphql-join config error for resolver "Product.reviews_Nullable_Outer": ' +
          'Query does not return the intended type "[Review!]" for "Product.reviews_Nullable_Outer". Returns "[Review]".'
      );
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId_Nullable(productIds: [$upc]) @unbatched',
          'Product',
          'reviews_Nullable_Inner',
          typeDefs,
          nullableSchema
        )
      ).toThrow(
        'graphql-join config error for resolver "Product.reviews_Nullable_Inner": ' +
          'Query does not return the intended type "[Review]!" for "Product.reviews_Nullable_Inner". Returns "[Review]".'
      );
      expect(() =>
        validateFieldConfig(
          'getReviewsByProductId_NonNullable(productIds: [$upc]) @unbatched',
          'Product',
          'reviews_Nullable_All',
          typeDefs,
          nullableSchema
        )
      ).not.toThrow();
    });
  });
});
