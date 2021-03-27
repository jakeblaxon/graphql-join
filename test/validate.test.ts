import {mergeSchemas} from '@graphql-tools/merge';
import {validateFieldConfig} from '../src/validate';
import {productSchema} from './fixtures/products';
import {reviewSchema} from './fixtures/reviews';

const mergedSchema = mergeSchemas({
  schemas: [productSchema, reviewSchema],
});

describe('validateFieldConfig', () => {
  it('should work', () => {
    validateFieldConfig(
      'getReviewsByProductId(productIds: $upc) { upc: productId }',
      'Product',
      'reviews',
      `#graphql
        extend type Review {
          product: Product
        }
        extend type Product {
          reviews: [Review!]!
        }
      `,
      mergedSchema
    );
  });
});
