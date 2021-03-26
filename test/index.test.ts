import {Kind, parse} from 'graphql';
import {
  createArgsFromKeysFunction,
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

describe('createSelectionSet', () => {
  it('should select all variables', () => {
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
    const result = createSelectionSet(getQueryFieldNode(joinQuery));
    expect(result).toEqual('{ bookTitle bookAuthor }');
  });
});

describe('getQueryName', () => {
  it('should return the name of the query', () => {
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
    const result = getQueryName(getQueryFieldNode(joinQuery));
    expect(result).toEqual('books');
  });
});

describe('createArgsFromKeysFunction', () => {
  it('should return args correctly', () => {
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
    const result = createArgsFromKeysFunction(getQueryFieldNode(joinQuery));
    const args = [
      {bookTitle: 'bookTitle 1', bookAuthor: 'bookAuthor 1'},
      {bookTitle: 'bookTitle 2', bookAuthor: 'bookAuthor 2'},
      {bookTitle: 'bookTitle 3', bookAuthor: 'bookAuthor 3'},
    ];
    console.log(JSON.stringify(result(args), null, 2));
  });
});
