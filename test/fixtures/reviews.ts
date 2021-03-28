import {makeExecutableSchema} from '@graphql-tools/schema';

const typeDefs = `#graphql
  type Query {
    getReviewsById(ids: [ID!]!): [Review!]!
    getReviewsByProductId(productIds: [String!]!): [Review!]!
  }

  type Review {
    id: ID!
    body: String
    productId: String!
  }
`;

const resolvers = {
  Query: {
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

export const reviewSchema = makeExecutableSchema({typeDefs, resolvers});
