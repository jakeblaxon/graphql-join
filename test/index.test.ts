import {Kind, parse} from 'graphql';
import {
  createArgsFromKeysFunction,
  createKeyMapping,
  createSelectionSet,
  getQueryName,
} from '../src';

function getQueryFieldNode(joinQuery: string) {
  const def = parse(`{${joinQuery}}`).definitions[0];
  const queryFieldNode =
    def.kind === Kind.OPERATION_DEFINITION &&
    def.selectionSet.selections[0].kind === Kind.FIELD &&
    def.selectionSet.selections[0];
  if (!queryFieldNode) throw Error('invalid joinQuery config');
  return queryFieldNode;
}

const joinQuery = `#graphql
    books(
        filter: {
            and: [
                { title: { in: $bookTitle } }
                { author: { in: $bookAuthor } }
            ]
        }
    ) {
        bookTitle: title
    }
`;
const joinQueryNode = getQueryFieldNode(joinQuery);

describe('createKeyMapping', () => {
  it('should create key map', () => {
    const result = createKeyMapping(joinQueryNode);
    expect(result).toEqual({title: 'bookTitle'});
  });
});

describe('createSelectionSet', () => {
  it('should select all variables', () => {
    const result = createSelectionSet(joinQueryNode);
    expect(result).toEqual('{ bookTitle bookAuthor }');
  });
});

describe('getQueryName', () => {
  it('should return the name of the query', () => {
    const result = getQueryName(joinQueryNode);
    expect(result).toEqual('books');
  });
});

describe('createArgsFromKeysFunction', () => {
  it('should return args correctly', () => {
    const result = createArgsFromKeysFunction(joinQueryNode);
    const args = [
      {bookTitle: 'bookTitle 1', bookAuthor: 'bookAuthor 1'},
      {bookTitle: 'bookTitle 2', bookAuthor: 'bookAuthor 2'},
      {bookTitle: 'bookTitle 3', bookAuthor: 'bookAuthor 3'},
    ];
    expect(result(args)).toEqual([
      {
        filter: {
          and: [
            {
              title: {
                in: ['bookTitle 1', 'bookTitle 2', 'bookTitle 3'],
              },
            },
            {
              author: {
                in: ['bookAuthor 1', 'bookAuthor 2', 'bookAuthor 3'],
              },
            },
          ],
        },
      },
    ]);
  });
});

describe('addRequiredChildFieldsToRequest', () => {});
