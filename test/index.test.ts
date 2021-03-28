import {execute, Kind, parse, print} from 'graphql';
import {makeExecutableSchema} from '@graphql-tools/schema';
import {wrapSchema} from '@graphql-tools/wrap';
import {
  createArgsFromKeysFunction,
  createChildSelectionSet,
  createParentSelectionSet,
  GraphQLJoin,
} from '../src';

const typeExtensions = `#graphql
  extend type Product {
    reviews: [Review!]!
  }
  extend type Review {
    product: Product!
  }
`;

const schema = makeExecutableSchema({
  typeDefs: `#graphql
    type Query {
      getProductsById(ids: [String!]!): [Product!]!
      getReviewsById(ids: [String!]!): [Review!]!
      getReviewsByProductId(productIds: [String!]!): [Review!]!
    }
    type Product {
      upc: String!
      name: String
      price: Int
      weight: Int
    }
    type Review {
      id: String!
      body: String
      productId: String!
    }
  `,
  resolvers: {
    Query: {
      getProductsById(parent: unknown, args: {ids: string[]}) {
        return products.filter(product => args.ids.includes(product.upc));
      },
      getReviewsById(parent: unknown, args: {ids: string[]}) {
        return reviews.filter(review => args.ids.includes(review.id));
      },
      getReviewsByProductId(parent: unknown, args: {productIds: string[]}) {
        return reviews.filter(review =>
          args.productIds.includes(review.productId)
        );
      },
    },
  },
});
const products = [
  {
    upc: '1',
    name: 'Table',
    price: 899,
    weight: 100,
  },
  {
    upc: '2',
    name: 'Couch',
    price: 1299,
    weight: 1000,
  },
  {
    upc: '3',
    name: 'Chair',
    price: 54,
    weight: 50,
  },
];
const reviews = [
  {
    id: '1',
    body: 'Love it!',
    productId: '1',
  },
  {
    id: '2',
    body: 'Too expensive.',
    productId: '2',
  },
  {
    id: '3',
    body: 'Could be better.',
    productId: '3',
  },
  {
    id: '4',
    body: 'Prefer something else.',
    productId: '1',
  },
];

describe('GraphQLJoin', () => {
  it('works', async () => {
    const graphqlJoinTransform = new GraphQLJoin({
      typeDefs: typeExtensions,
      resolvers: {
        Review: {
          product: 'getProductsById(ids: $productId) { productId: upc }',
        },
        Product: {
          reviews: 'getReviewsByProductId(productIds: $upc) { upc: productId }',
        },
      },
    });
    const wrappedSchema = wrapSchema({
      schema,
      transforms: [graphqlJoinTransform],
    });
    const result = await execute(
      wrappedSchema,
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
    expect(result).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "getReviewsById": Array [
            Object {
              "body": "Love it!",
              "id": "1",
              "product": Object {
                "name": "Table",
                "price": 899,
                "reviews": Array [
                  Object {
                    "body": "Love it!",
                    "id": "1",
                  },
                  Object {
                    "body": "Prefer something else.",
                    "id": "4",
                  },
                ],
                "weight": 100,
              },
            },
            Object {
              "body": "Too expensive.",
              "id": "2",
              "product": Object {
                "name": "Couch",
                "price": 1299,
                "reviews": Array [
                  Object {
                    "body": "Too expensive.",
                    "id": "2",
                  },
                ],
                "weight": 1000,
              },
            },
            Object {
              "body": "Could be better.",
              "id": "3",
              "product": Object {
                "name": "Chair",
                "price": 54,
                "reviews": Array [
                  Object {
                    "body": "Could be better.",
                    "id": "3",
                  },
                ],
                "weight": 50,
              },
            },
            Object {
              "body": "Prefer something else.",
              "id": "4",
              "product": Object {
                "name": "Table",
                "price": 899,
                "reviews": Array [
                  Object {
                    "body": "Love it!",
                    "id": "1",
                  },
                  Object {
                    "body": "Prefer something else.",
                    "id": "4",
                  },
                ],
                "weight": 100,
              },
            },
          ],
        },
      }
    `);
  });
});

function getQueryFieldNode(joinQuery: string) {
  const def = parse(`{${joinQuery}}`).definitions[0];
  const queryFieldNode =
    def.kind === Kind.OPERATION_DEFINITION &&
    def.selectionSet.selections[0].kind === Kind.FIELD &&
    def.selectionSet.selections[0];
  if (!queryFieldNode) throw Error('Cannot find query field');
  return queryFieldNode;
}

describe('createParentSelectionSet', () => {
  it('selects all selection fields', () => {
    const result = createParentSelectionSet(
      getQueryFieldNode(`#graphql
        books {
          title
          author
        }
      `)
    );
    expect(result).toEqual('{ title author }');
  });

  it('selects selection field aliases', () => {
    const result = createParentSelectionSet(
      getQueryFieldNode(`#graphql
        books {
          bookTitle: title
        }
      `)
    );
    expect(result).toEqual('{ bookTitle }');
  });

  it('selects all variables', () => {
    const result = createParentSelectionSet(
      getQueryFieldNode(`#graphql
        books(where: {title: {in: $title} author: {in: $author}})  {
          title
        }
      `)
    );
    expect(result).toEqual('{ title author }');
  });
});

describe('createChildSelectionSet', () => {
  it('selects all selection fields', () => {
    const result = createChildSelectionSet(
      getQueryFieldNode(`#graphql
        books {
          title
          author
        }
      `)
    );
    expect(result.map(node => print(node)).join(' ')).toEqual('title author');
  });

  it('ignores selection field aliases', () => {
    const result = createChildSelectionSet(
      getQueryFieldNode(`#graphql
        books {
          bookTitle: title
        }
      `)
    );
    expect(result.map(node => print(node)).join(' ')).toEqual('title');
  });
});

describe('createArgsFromKeysFunction', () => {
  it('returns empty object when no args are provided', () => {
    const result = createArgsFromKeysFunction(
      getQueryFieldNode(`#graphql
        books { title }
      `)
    );
    expect(result([])).toEqual({});
  });

  it('returns args as-is when no variables are provided', () => {
    const result = createArgsFromKeysFunction(
      getQueryFieldNode(`#graphql
        books(where: {author: {in: "Shakespeare"}})  {
          title
        }
      `)
    );
    expect(result([])).toEqual({where: {author: {in: 'Shakespeare'}}});
  });

  it('returns all explicit scalar values', () => {
    const result = createArgsFromKeysFunction(
      getQueryFieldNode(`#graphql
        books(
          int: 1
          float: 1.5
          string: "string"
          booleanTrue: true
          booleanFalse: false
          null: null
          enum: EnumValue
          lists: {
            ints: [1, 2]
            floats: [1, 1.5]
            strings: ["string1", "string2"]
            booleans: [true, false]
            nulls: [null, null]
            enums: [EnumValue1, EnumValue2]
          }
          wrapped: [
            {int: 1}
            {float: 1.5}
            {string: "string"}
            {booleanTrue: true}
            {booleanFalse: false}
            {null: null}
            {enum: EnumValue}
          ]
        ) {
          title
        }
      `)
    );
    expect(result([])).toEqual({
      int: 1,
      float: 1.5,
      string: 'string',
      booleanTrue: true,
      booleanFalse: false,
      null: null,
      enum: 'EnumValue',
      lists: {
        ints: [1, 2],
        floats: [1, 1.5],
        strings: ['string1', 'string2'],
        booleans: [true, false],
        nulls: [null, null],
        enums: ['EnumValue1', 'EnumValue2'],
      },
      wrapped: [
        {int: 1},
        {float: 1.5},
        {string: 'string'},
        {booleanTrue: true},
        {booleanFalse: false},
        {null: null},
        {enum: 'EnumValue'},
      ],
    });
  });

  it('returns args correctly', () => {
    const result = createArgsFromKeysFunction(
      getQueryFieldNode(`#graphql
        books(where: {title: {in: $title} author: {in: $author}})  {
          title
        }
      `)
    );
    const args = [
      {title: 'title 1', author: 'author 1'},
      {title: 'title 2', author: 'author 2'},
      {title: 'title 3', author: 'author 3'},
    ];
    expect(result(args)).toMatchInlineSnapshot(`
      Object {
        "where": Object {
          "author": Object {
            "in": Array [
              "author 1",
              "author 2",
              "author 3",
            ],
          },
          "title": Object {
            "in": Array [
              "title 1",
              "title 2",
              "title 3",
            ],
          },
        },
      }
    `);
  });
});
