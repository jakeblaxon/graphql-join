# GraphQL-Join

Join types together in your schema purely with SDL. Let GraphQL-Join handle the rest.

## Example

Say you have a GraphQL schema that looks like the following:

```graphql
type Query {
  getAuthors(ids: [String]): [Author]
  getBooks(ids: [String]): [Book]
}
type Author {
  id: String!
  name: String
}
type Book {
  id: String!
  title: String
  authorId: String
}
```

The `Book` type has a reference to its `Author`, but only in the form of a String. We want to add a new field `Book.author` that points to the actual object, like so:

```graphql
extend type Book {
  author: Author
}
```

Normally you can do this in the backend, but what happens if you don't have access to the original data source? For example, this could be a third party schema, or it could be automatically generated with something like [Hasura](https://hasura.io). You will instead have to join these types together in a gateway, making batched subqueries to the original schema:

![subquery sequence diagram](./images/subquery_sequence_diagram.png)
<!--
note right of Client: getBooks {id, author {name}}
Client->Gateway: 
note right of Gateway: getBooks {id, authorId} 
Gateway->Schema:
Schema->Gateway:
note right of Gateway: getAuthors(ids: [...]) {id, name} 
Gateway->Schema:
Schema->Gateway:
note over Gateway: join Authors to Books\nbased on authorId
Gateway->Client:
-->

You can implement this pattern in code, but it becomes tedious and hard to read the more joins you add. It's also error-prone and not type safe. As the underlying schema changes, old resolver logic can quietly become obsolete. GraphQL-Join aims to solve these issues by abstracting away the details. All you need to provide is an SDL string that describes the subquery to make. The following schema transform will implement the same pattern, but is much more readable:

```js
const graphqlJoinTransform = new GraphQLJoinTransform({
    typeDefs: `
        extend type Book {
            author: Author
        }
    `,
    resolvers: {
        Book: {
            author: `getAuthors(ids: $authorId) { id: authorId }`
        }
    }
});

const gatewaySchema = wrapSchema({
    schema: originalSchema,
    transforms: [graphqlJoinTransform],
});
```
