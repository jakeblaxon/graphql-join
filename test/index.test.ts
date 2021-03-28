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

// describe('createArgsFromKeysFunction', () => {
//   it('should return args correctly', () => {
//     const result = createArgsFromKeysFunction(joinQueryNode);
//     const args = [
//       {bookTitle: 'bookTitle 1', bookAuthor: 'bookAuthor 1'},
//       {bookTitle: 'bookTitle 2', bookAuthor: 'bookAuthor 2'},
//       {bookTitle: 'bookTitle 3', bookAuthor: 'bookAuthor 3'},
//     ];
//     expect(result(args)).toEqual({
//       filter: {
//         and: [
//           {
//             title: {
//               in: ['bookTitle 1', 'bookTitle 2', 'bookTitle 3'],
//             },
//           },
//           {
//             author: {
//               in: ['bookAuthor 1', 'bookAuthor 2', 'bookAuthor 3'],
//             },
//           },
//         ],
//       },
//     });
//   });
// });
