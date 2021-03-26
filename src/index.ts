import {
  FieldNode,
  GraphQLSchema,
  isListType,
  Kind,
  parse,
  visit,
} from 'graphql';
import {batchDelegateToSchema} from '@graphql-tools/batch-delegate';
import {Transform} from '@graphql-tools/delegate';
import {stitchSchemas} from '@graphql-tools/stitch';
import {IResolvers} from '@graphql-tools/utils';
import _ from 'lodash';
import {WrapQuery} from '@graphql-tools/wrap';
interface GraphQLJoinConfig {
  typedefs: string;
  resolvers: {
    [type: string]: {
      [field: string]: {
        joinQuery: string;
      };
    };
  };
}

// export default class GraphQLJoin implements Transform {
//   private transformedSchema: GraphQLSchema | null = null;
//   constructor(private config: GraphQLJoinConfig) {}

//   public transformSchema(originalWrappingSchema: GraphQLSchema) {
//     this.transformedSchema = stitchSchemas({
//       subschemas: [originalWrappingSchema],
//       typeDefs: this.config.typedefs,
//       resolvers: this.createResolvers(this.config.resolvers),
//     });
//     return this.transformedSchema;
//   }

//   private createResolvers(resolversConfig: GraphQLJoinConfig['resolvers']) {
//     return _.mapValues(resolversConfig, (typeConfig, type) =>
//       _.mapValues(typeConfig, (fieldConfig, field) => {
//         const def = parse(`{${fieldConfig.joinQuery}}`).definitions[0];
//         const queryFieldNode =
//           def.kind === Kind.OPERATION_DEFINITION &&
//           def.selectionSet.selections[0].kind === Kind.FIELD &&
//           def.selectionSet.selections[0];
//         if (!queryFieldNode) throw Error('invalid joinQuery config');
//         return {
//           selectionSet: createSelectionSet(queryFieldNode),
//           resolve: (parent, args, context, info) =>
//             batchDelegateToSchema({
//               schema: this.transformedSchema!,
//               operation: 'query',
//               fieldName: getQueryName(queryFieldNode),
//               key: parent,
//               argsFromKeys: createArgsFromKeysFunction(queryFieldNode),
//               valuesFromResults: (results, keys) =>
//                 mapChildrenToParents(
//                   results,
//                   keys,
//                   fieldConfig.joinOn,
//                   isListType(info.returnType)
//                 ),
//               context,
//               info,
//               transforms: [selectChildKeys],
//             }),
//         } as IResolvers;
//       })
//     );
//   }
// }

export function createSelectionSet(queryFieldNode: FieldNode) {
  const fields = new Set<string>();
  visit(queryFieldNode, {
    Variable: node => {
      fields.add(node.name.value);
    },
    Field: (node, key, parent, path, ancestors) => {
      ancestors.length > 4 && fields.add(node.alias?.value || node.name.value);
    },
  });
  return `{ ${Array.from(fields).join(' ')} }`;
}

export function getQueryName(queryFieldNode: FieldNode) {
  return queryFieldNode.name.value;
}

export function createArgsFromKeysFunction(queryFieldNode: FieldNode) {
  const variables = new Set<string>();
  visit(queryFieldNode, {
    Variable: node => {
      variables.add(node.name.value);
    },
  });
  const variableValues = new Map<string, any[]>();
  return (parents: readonly any[]) => {
    variables.forEach(variable =>
      variableValues.set(
        variable,
        _(parents)
          .map(parent => _.get(parent, variable))
          .uniq()
          .filter(val => val)
          .value()
      )
    );
    return visit(queryFieldNode, {
      leave: {
        Argument: node => ({[node.name.value]: node.value}),
        ObjectValue: node =>
          node.fields.reduce((obj, field) => {
            obj[field.name.value] = field.value;
            return obj;
          }, {} as Record<string, any>),
        ListValue: node => node.values,
        Variable: node => variableValues.get(node.name.value),
      },
    }).arguments;
  };
}
