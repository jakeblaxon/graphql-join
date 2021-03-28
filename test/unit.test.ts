import {Kind, parse} from 'graphql';
import {createArgsFromKeysFunction, createParentSelectionSet} from '../src';

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
    )  {
        bookTitle: title
    } options @withArg(storeId: "filter: {and: [{storeId: {in: $storeId}}]}")
`;
const joinQueryNode = getQueryFieldNode(joinQuery);

describe('createSelectionSet', () => {
  it('should select all variables', () => {
    const result = createParentSelectionSet(joinQueryNode);
    expect(result).toEqual('{ bookTitle bookAuthor }');
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
    expect(result(args)).toEqual({
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
    });
  });
});

describe('addRequiredChildFieldsToRequest', () => {});
