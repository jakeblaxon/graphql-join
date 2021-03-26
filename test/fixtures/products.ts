import {makeExecutableSchema} from '@graphql-tools/schema';

const typeDefs = `#graphql
  type Query {
    getProductsById(ids: [String!]!): [Product!]!
  }

  type Product {
    upc: String!
    name: String
    price: Int
    weight: Int
  }
`;

const resolvers = {
  Query: {
    getProductsById(parent: unknown, args: {ids: string[]}) {
      return products.filter(product => args.ids.includes(product.upc));
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

export const productSchema = makeExecutableSchema({typeDefs, resolvers});
