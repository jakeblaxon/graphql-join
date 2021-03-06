# GraphQL-Join

Join types together in your schema declaratively with SDL.

> :warning: This library is new and still evolving. Breaking changes will occur. Use it at your own risk.

## Getting Started

```
npm install graphql-join graphql
```

Once these packages are installed, you can create a GraphQL-Join transform and wrap your original schema with it to create the gateway schema. You can [view the demo](https://codesandbox.io/s/github/jakeblaxon/graphql-join-demo) that goes along with the example below.

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

You can implement this pattern in code, but it becomes tedious and hard to read the more joins you add. It's also error-prone and not type-safe. As the underlying schema changes, old resolver logic can quietly become obsolete and begin to fail.

GraphQL-Join aims to solve these issues by abstracting away the details. All you need to provide is an SDL string that describes the subquery to make. The following schema transform implements this pattern declaratively, and is more readable:

```js
import GraphQLJoinTransform from 'graphql-join';
import {wrapSchema} from '@graphql-tools/wrap';

const graphqlJoinTransform = new GraphQLJoinTransform({
  typeDefs: `
    extend type Book {
      author: Author
    }
  `,
  resolvers: {
    Book: {
      author: `getAuthors(ids: $authorId) { authorId: id }`,
    },
  },
});

const gatewaySchema = wrapSchema({
  schema: originalSchema,
  transforms: [graphqlJoinTransform],
});
```

The `typeDefs` field describes the overall joins you'd like to add, whereas the `resolvers` field details how to resolve each join. You can see at `Book.author`, we added SDL describing the batched subquery to make to resolve authors for books. Let's look at some of the special syntax:

- `getAuthors` is the name of the batched query. It will retrieve every author for the books in one call to prevent the n+1 problem.
- The `$authorId` variable indicates what field of the parent type (`Book`) we wish to pass to the parameters. Behind the scenes, GraphQL-Join collects all distinct `authorId` fields of each book into a list and filters out any `null` values. The type of `$authorId` is therefore always `[String!]!`. Each field within the parent type has a corresponding variable of the same name you can use in the parameters. They are always distinct, non-null lists of the field's type.
- The `{ authorId: id }` selection indicates which fields in the parent and child to join on. Since they are different names, we use an alias to map them together. Here we are saying to match authors to books where `Book.authorId = Author.id`. You can select more than one field, as long as they are all scalar types. GraphQL-Join will consider a pairing a match if all corresponding fields match.

GraphQL-Join doesn't call this query exactly as written. It simply uses the information within it to generate a custom query for each request. Behind the scenes, GraphQL-Join will strip the aliases and add the user requested fields to the selection set, to get all the required information in one call.

## Joining on Lists

GraphQL-Join supports one-to-one, one-to-many, and many-to-many relationships. In reality, `Book` to `Author` is not one-to-one but many-to-many. Let's see how this could look:

```graphql
type Book {
  id: String!
  title: String
  authorIds: [String]
}
```

To join them together, we can use the following config:

```js
{
  typeDefs: `
    extend type Book {
      authors: [Author!]!
    }
  `,
  resolvers: {
    Book: {
      authors: `getAuthors(ids: $authorIds) { authorIds: id }`
    }
  }
}
```

The query looks very similar to the one-to-one example, but there are a few key differences:

- `$authorIds` is now plural, because it is plural in the `Book` type. Though `Book.authorIds` is a list, GraphQL-Join still passes in a list of type `[String!]!`. It takes the distinct, non-null union across each `authorIds` list as the value for `$authorIds`.
- `{ authorIds: id }` is technically mapping a list type to a scalar type. In this case, GraphQL-Join will consider a pairing a match if the value of `Author.id` is included in `Book.authorIds`. It does not map `null` values, however, as that is commonly used to indicate the absence of a mapping.

You can also add a symmetrical relation to your config like the following:

```js
{
  typeDefs: `
    extend type Author {
      books: [Book!]!
    }
    extend type Book {
      authors: [Author!]!
    }
  `,
  resolvers: {
    Author: {
      books: `getBooksByAuthorIds(ids: $id) { id: authorIds }`
    },
    Book: {
      authors: `getAuthors(ids: $authorIds) { authorIds: id }`
    }
  }
}
```

Note that in this case we have to call a new query `getBooksByAuthorIds` because we don't have access to book ids in `Author`.

As a final note, if you are going to join on a list, then the list can only contain scalar values, and you can only use this one field to join on. GraphQL-Join will not let you use more than one selection if the selection is a list type. This is because it's unclear how to match in this case, as there are multiple options that lead to different results.

## Custom Parameters

You can add custom parameters to your fields that can be passed through to the subquery. To do this, simply define the parameters in your typeDefs, and use the parameters by name as variables in your query:

```js
{
  typeDefs: `
    extend type Author {
      books(publishedAfter: Int!): [Book!]!
    }
  `,
  resolvers: {
    Author: {
      books: `
        getBooksByAuthorIds(
          ids: $id,
          publicationYearGreaterThan: $publishedAfter
        ) { 
          id: authorIds
        }`
    }
  }
}
```

Now whatever the user passes in as the `publishedAfter` parameter for `Author.books` will get passed to the subquery as the value of the `$publishedAfter` variable.

All custom parameters that you use must be non-nullable, to ensure that the subquery is always valid. You may specify default values in the typeDefs, however. Try to use custom parameter names that don't conflict with field names in the parent type, or else those parent fields will be unavailable to use in the subquery. The variable corresponding to the conflicting parameter/field name will always be set to the parameter value in this case.

## Unbatched Queries

GraphQL-Join supports batched queries by default, but in certain cases it may not be possible to join with a batched query because the parent and child don't share any common key fields to join on. In this situation, you can make "unbatched" queries (one query per parent) to join parents to children. To specify this, simply replace the selection set with an `@unbatched` directive on the query:

```js
resolvers: {
  Book: {
    author: `getAuthor(id: $authorId) @unbatched`
  }
}
```

The `$authorId` parameter will be set to whatever value the `parent.authorId` is, because there is only one parent in this case. There is no selection set here because the `Book.author` field will be set to whatever the unbatched query returns, therefore making a key mapping unnecessary.

> :warning: Unbatched queries should be avoided if at all possible because they result in the n+1 problem. Each parent object will make its own network call, potentially congesting the network and increasing delay times.

## Advanced

GraphQL-Join is built on top of the [`@graphql-tools` library](https://www.graphql-tools.com/), currently using major version 7. It specifically uses the `batchDelegateToSchema`, `delegateToSchema`, and `stitchSchemas` methods to create the resolver implementations under the hood. Since there are breaking changes in these methods across major versions, GraphQL-Join allows you to specify which instances of these methods it should use, so that it may work with other libraries using a specific version of `@graphql-tools`. You can specify this in the `GraphQLJoinTransform` config as follows:

```js
new GraphQLJoinTransform({
  typeDefs: ...
  resolvers: ...
  graphqlTools: {
    batchDelegateToSchema: batchDelegateToSchemaV6,
    delegateToSchema: delegateToSchemaV6,
    stitchSchemas: stitchSchemasV6,
  }
})
```

## Benefits

Using GraphQL-Join has several benefits:

- It's simple. The configuration is declarative, concise, and written in conventional GraphQL SDL. No new syntax to learn, no complex logic to parse, and no need to modify selection sets in code.
- It's fast. The joining logic is always O(n), regardless of whether you're matching on scalars or lists.
- It's type-safe. GraphQL-Join checks on initialization if the variable fields and return type match their expected types. It also validates the query against the schema. If any of these checks fail, it errors out. This guards against silent failures as the underlying schema evolves.
- It works natively with other libraries, like [graphql-tools](https://www.graphql-tools.com) and [graphql-mesh](https://www.graphql-mesh.com). This allows for even further schema manipulations with minimal user effort.

## Contributing

GraphQL-Join is a new library and is still evolving. If you have an idea on how to improve it, please open an issue on GitHub, or fork this library and create a pull request.
