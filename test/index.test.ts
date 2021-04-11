import {execute, Kind, parse, print} from 'graphql';
import {makeExecutableSchema} from '@graphql-tools/schema';
import {wrapSchema} from '@graphql-tools/wrap';
import GraphQLJoinTransform, {
  createArgsFromKeysFunction,
  createChildSelectionSet,
  createParentSelectionSet,
  mapChildrenToParents,
} from '../src';

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
      `),
      true
    );
    expect(result([])).toEqual({});
  });

  it('returns args as-is when no variables are provided', () => {
    const result = createArgsFromKeysFunction(
      getQueryFieldNode(`#graphql
        books(where: {author: [{first: "William"}, {last: "Shakespeare"}]})  {
          title
        }
      `),
      true
    );
    expect(result([])).toEqual({
      where: {author: [{first: 'William'}, {last: 'Shakespeare'}]},
    });
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
      `),
      true
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

  it('replaces each variable with a unique non-null list of its corresponding field in the parent, when batched is true', () => {
    const result = createArgsFromKeysFunction(
      getQueryFieldNode(`#graphql
        books(titles: $title)  {
          title
        }
      `),
      true
    );
    const parentsScalar = [
      {title: 'title 1'},
      {title: 'title 2'},
      {title: 'title 2'},
      {title: ''},
      {title: null},
      {title: undefined},
    ];
    expect(result(parentsScalar)).toEqual({titles: ['title 1', 'title 2', '']});
    const parentsList = [
      {title: ['title 1', 'title 2']},
      {title: ['title 2', '', null]},
      {title: undefined},
    ];
    expect(result(parentsList)).toEqual({titles: ['title 1', 'title 2', '']});
  });

  it('replaces each variable with the value of its corresponding field in the parent, when batched is false', () => {
    const result = createArgsFromKeysFunction(
      getQueryFieldNode(`#graphql
        books(title: $title) @unbatched
      `),
      false
    );
    const parent = {title: 'title 1'};
    expect(result([parent])).toEqual({title: 'title 1'});
  });

  it('handles variables in lists properly', () => {
    const result = createArgsFromKeysFunction(
      getQueryFieldNode(`#graphql
        books(where: [$title, $author])  {
          title
        }
      `),
      true
    );
    const parents = [
      {title: 'title 1', author: 'author 1'},
      {title: 'title 2', author: null},
    ];
    expect(result(parents)).toEqual({
      where: [['title 1', 'title 2'], ['author 1']],
    });
  });

  it('handles variables in objects properly', () => {
    const result = createArgsFromKeysFunction(
      getQueryFieldNode(`#graphql
        books(where: {title: $title})  {
          title
        }
      `),
      true
    );
    const parents = [{title: 'title 1'}];
    expect(result(parents)).toEqual({
      where: {title: ['title 1']},
    });
  });
});

describe('mapChildrenToParents', () => {
  it('maps parent to null or empty list when no matching children are found', () => {
    const queryFieldNode = getQueryFieldNode(`#graphql
      books { title }
    `);
    expect(
      mapChildrenToParents([], [{title: 'title 1'}], queryFieldNode, false)
    ).toEqual([null]);
    expect(
      mapChildrenToParents([], [{title: 'title 1'}], queryFieldNode, true)
    ).toEqual([[]]);
  });

  it('does not match on keys that are null', () => {
    const queryFieldNode = getQueryFieldNode(`#graphql
      books { title }
    `);
    const result = mapChildrenToParents(
      [{id: 1, title: null}],
      [{title: null}],
      queryFieldNode,
      false
    );
    expect(result).toEqual([null]);
  });

  it('matches to single child when toManyRelation is false', () => {
    const queryFieldNode = getQueryFieldNode(`#graphql
      books { title }
    `);
    const result = mapChildrenToParents(
      [
        {id: 1, title: 'title 2'},
        {id: 2, title: 'title 1'},
      ],
      [{title: 'title 1'}, {title: 'title 2'}],
      queryFieldNode,
      false
    );
    expect(result).toEqual([
      {id: 2, title: 'title 1'},
      {id: 1, title: 'title 2'},
    ]);
  });

  it('matches to list of children when toManyRelation is true', () => {
    const queryFieldNode = getQueryFieldNode(`#graphql
      books { title }
    `);
    const result = mapChildrenToParents(
      [
        {id: 1, title: 'title 2'},
        {id: 2, title: 'title 1'},
        {id: 3, title: 'title 1'},
      ],
      [{title: 'title 1'}, {title: 'title 2'}],
      queryFieldNode,
      true
    );
    expect(result).toEqual([
      [
        {id: 2, title: 'title 1'},
        {id: 3, title: 'title 1'},
      ],
      [{id: 1, title: 'title 2'}],
    ]);
  });

  it('matches using aliases', () => {
    const queryFieldNode = getQueryFieldNode(`#graphql
      books { bookTitle: title }
    `);
    const result = mapChildrenToParents(
      [
        {id: 1, title: 'title 2'},
        {id: 2, title: 'title 1'},
      ],
      [{bookTitle: 'title 1'}],
      queryFieldNode,
      false
    );
    expect(result).toEqual([{id: 2, title: 'title 1'}]);
  });

  it('matches using all join keys', () => {
    const queryFieldNode = getQueryFieldNode(`#graphql
      books { title author }
    `);
    const result = mapChildrenToParents(
      [
        {id: 1, title: 'title 1', author: 'author 1'},
        {id: 2, title: 'title 1', author: 'author 2'},
        {id: 3, title: 'title 2', author: 'author 2'},
      ],
      [
        {title: 'title 1', author: 'author 1'},
        {title: 'title 2', author: 'author 2'},
      ],
      queryFieldNode,
      true
    );
    expect(result).toEqual([
      [{id: 1, title: 'title 1', author: 'author 1'}],
      [{id: 3, title: 'title 2', author: 'author 2'}],
    ]);
  });

  it('matches by containment if child key type is a list', () => {
    const queryFieldNode = getQueryFieldNode(`#graphql
      books { title: titles }
    `);
    const result = mapChildrenToParents(
      [
        {id: 1, titles: ['title 1', null]},
        {id: 2, titles: ['title 1', 'title 2']},
        {id: 3, titles: []},
        {id: 4, titles: null},
      ],
      [{title: 'title 1'}, {title: 'title 2'}, {title: null}],
      queryFieldNode,
      true
    );
    expect(result).toEqual([
      [
        {id: 1, titles: ['title 1', null]},
        {id: 2, titles: ['title 1', 'title 2']},
      ],
      [{id: 2, titles: ['title 1', 'title 2']}],
      [],
    ]);
  });

  it('matches by containment if parent key type is a list', () => {
    const queryFieldNode = getQueryFieldNode(`#graphql
      books { titles: title }
    `);
    const result = mapChildrenToParents(
      [
        {id: 1, title: 'title 1'},
        {id: 2, title: 'title 2'},
        {id: 3, title: null},
      ],
      [
        {titles: ['title 1', null]},
        {titles: ['title 1', 'title 2']},
        {titles: []},
        {titles: null},
      ],
      queryFieldNode,
      true
    );
    expect(result).toEqual([
      [{id: 1, title: 'title 1'}],
      [
        {id: 1, title: 'title 1'},
        {id: 2, title: 'title 2'},
      ],
      [],
      [],
    ]);
  });

  it('matches by intersection if both child and parent key types are lists', () => {
    const queryFieldNode = getQueryFieldNode(`#graphql
      books { titles }
    `);
    const result = mapChildrenToParents(
      [
        {id: 1, titles: ['title 1', null]},
        {id: 2, titles: ['title 1', 'title 2']},
        {id: 3, titles: ['title 3']},
        {id: 4, titles: null},
      ],
      [
        {titles: ['title 1']},
        {titles: ['title 1', 'title 2', 'title 3']},
        {titles: ['title 2', 'title 3']},
        {titles: ['title 3', null]},
        {titles: null},
      ],
      queryFieldNode,
      true
    );
    expect(result).toEqual([
      [
        {id: 1, titles: ['title 1', null]},
        {id: 2, titles: ['title 1', 'title 2']},
      ],
      [
        {id: 1, titles: ['title 1', null]},
        {id: 2, titles: ['title 1', 'title 2']},
        {id: 3, titles: ['title 3']},
      ],
      [
        {id: 2, titles: ['title 1', 'title 2']},
        {id: 3, titles: ['title 3']},
      ],
      [{id: 3, titles: ['title 3']}],
      [],
    ]);
  });
});

describe('GraphQLJoinTransform', () => {
  const typeDefs = `#graphql
    type Query {
      getProductsById(ids: [String!]!): [Product!]!
      getProductById(id: String!): Product
      getReviewsById(ids: [String!]!): [Review]
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
  `;

  const typeExtensions = `#graphql
    extend type Product {
      reviews: [Review!]!
    }
    extend type Review {
      product: Product!
      productUnbatched: Product
    }
  `;

  const resolvers = {
    Query: {
      getProductsById(parent: unknown, args: {ids: string[]}) {
        return products.filter(product => args.ids.includes(product.upc));
      },
      getProductById(parent: unknown, args: {ids: string[]}) {
        return products.find(product => args.ids.includes(product.upc));
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
  };

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

  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  const graphqlJoinTransform = new GraphQLJoinTransform({
    typeDefs: typeExtensions,
    resolvers: {
      Review: {
        product: 'getProductsById(ids: $productId) { productId: upc }',
        productUnbatched: 'getProductById(id: $productId) @unbatched',
      },
      Product: {
        reviews: 'getReviewsByProductId(productIds: $upc) { upc: productId }',
      },
    },
  });

  it('propagates errors encountered when executing subqueries', async () => {
    const wrappedSchema = wrapSchema({
      schema: makeExecutableSchema({
        typeDefs,
        resolvers: {
          Query: {
            ...resolvers.Query,
            getProductsById() {
              throw Error('error in getProductsById');
            },
            getProductById() {
              throw Error('error in getProductById');
            },
          },
        },
      }),
      transforms: [graphqlJoinTransform],
    });
    const result = await execute(
      wrappedSchema,
      parse(
        '{ getReviewsById(ids: ["1", "2", "3", "4"]) { id product { name } } }'
      )
    );
    expect(result.errors?.[0]).toEqual({
      message: 'error in getProductsById',
      locations: [],
      path: ['getReviewsById', 0, 'product'],
    });
    const resultUnbatched = await execute(
      wrappedSchema,
      parse(
        '{ getReviewsById(ids: ["1", "2", "3", "4"]) { id productUnbatched { name } } }'
      )
    );
    expect(resultUnbatched.errors?.[0]).toEqual({
      message: 'error in getProductById',
      locations: [],
      path: ['getReviewsById', 0, 'productUnbatched'],
    });
  });

  it('does not require key fields in user query selection set', async () => {
    const wrappedSchema = wrapSchema({
      schema,
      transforms: [graphqlJoinTransform],
    });
    const result = await execute(
      wrappedSchema,
      parse(`#graphql
        {
          getReviewsById(ids: ["1", "2", "3", "4"]) {
            body
            product {
              name
            }
          }
        }
      `)
    );
    expect(result).toEqual({
      data: {
        getReviewsById: [
          {
            body: 'Love it!',
            product: {
              name: 'Table',
            },
          },
          {
            body: 'Too expensive.',
            product: {
              name: 'Couch',
            },
          },
          {
            body: 'Could be better.',
            product: {
              name: 'Chair',
            },
          },
          {
            body: 'Prefer something else.',
            product: {
              name: 'Table',
            },
          },
        ],
      },
    });
  });

  it('allows aliases that conflict with parent key name', async () => {
    const wrappedSchema = wrapSchema({
      schema,
      transforms: [graphqlJoinTransform],
    });
    const result = await execute(
      wrappedSchema,
      parse(`#graphql
        {
          getReviewsById(ids: ["1", "2"]) {
            id
            product {
              productId: name
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
            product: {
              productId: 'Table',
            },
          },
          {
            id: '2',
            product: {
              productId: 'Couch',
            },
          },
        ],
      },
    });
  });

  it('allows parent key aliases that conflict with another field in the child', async () => {
    const wrappedSchema = wrapSchema({
      schema: makeExecutableSchema({
        typeDefs: `#graphql
          type Query {
            authors: [Author]
            books: [Book]
          }
          type Author {
            id: String
            titles: [String]
          }
          type Book {
            title: String
            titles: Boolean
          }
        `,
        resolvers: {
          Query: {
            authors: () => [
              {id: 'author 1', titles: ['book 1', 'book 2']},
              {id: 'author 2', titles: ['book 2', 'book 3']},
            ],
            books: () => [
              {title: 'book 1', titles: true},
              {title: 'book 2', titles: false},
            ],
          },
        },
      }),
      transforms: [
        new GraphQLJoinTransform({
          typeDefs: `#graphql
            extend type Author {
              books: [Book!]!
            }
          `,
          resolvers: {
            Author: {
              books: 'books { titles: title }',
            },
          },
        }),
      ],
    });
    const result = await execute(
      wrappedSchema,
      parse(`#graphql
        {
          authors {
            id
            books {
              title
              titles
            }
          }
        }
      `)
    );
    expect(result).toEqual({
      data: {
        authors: [
          {
            id: 'author 1',
            books: [
              {title: 'book 1', titles: true},
              {title: 'book 2', titles: false},
            ],
          },
          {
            id: 'author 2',
            books: [{title: 'book 2', titles: false}],
          },
        ],
      },
    });
  });

  it('supports nested relations', async () => {
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
