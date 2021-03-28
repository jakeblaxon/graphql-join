import {
  FieldNode,
  GraphQLOutputType,
  GraphQLSchema,
  isListType,
  isNonNullType,
  SelectionNode,
  visit,
} from 'graphql';
import {batchDelegateToSchema} from '@graphql-tools/batch-delegate';
import {Transform} from '@graphql-tools/delegate';
import {stitchSchemas} from '@graphql-tools/stitch';
import {IResolvers} from '@graphql-tools/utils';
import {WrapQuery} from '@graphql-tools/wrap';
import _ from 'lodash';
import {validateFieldConfig} from './validate';

export interface GraphQLJoinConfig {
  typeDefs: string;
  resolvers: {
    [type: string]: {
      [field: string]: string;
    };
  };
}

export class GraphQLJoin implements Transform {
  constructor(private config: GraphQLJoinConfig) {}
  public transformSchema(originalSchema: GraphQLSchema) {
    return stitchSchemas({
      subschemas: [originalSchema],
      typeDefs: this.config.typeDefs,
      resolvers: _.mapValues(this.config.resolvers, (typeConfig, typeName) =>
        _.mapValues(typeConfig, (fieldConfig, fieldName) => {
          return createFieldResolver(
            validateFieldConfig(
              fieldConfig,
              typeName,
              fieldName,
              this.config.typeDefs,
              originalSchema
            ),
            originalSchema
          );
        })
      ),
    });
  }
}

export function createFieldResolver(
  queryFieldNode: FieldNode,
  schema: GraphQLSchema
) {
  const argsFromKeys = createArgsFromKeysFunction(queryFieldNode);
  const childSelectionSetTransform = new WrapQuery(
    [queryFieldNode.name.value],
    selectionSet => ({
      ...selectionSet,
      selections: selectionSet.selections.concat(
        createChildSelectionSet(queryFieldNode)
      ),
    }),
    result => result
  );
  return {
    selectionSet: createParentSelectionSet(queryFieldNode),
    resolve: (parent, args, context, info) =>
      batchDelegateToSchema({
        schema,
        operation: 'query',
        fieldName: queryFieldNode.name.value,
        key: parent,
        context,
        info,
        transforms: [childSelectionSetTransform],
        argsFromKeys,
        valuesFromResults: (results, keys) =>
          mapChildrenToParents(results, keys, queryFieldNode, info.returnType),
      }),
  } as IResolvers;
}

export function createParentSelectionSet(queryFieldNode: FieldNode) {
  const fields = new Set<string>();
  visit(queryFieldNode, {
    Variable: node => {
      fields.add(node.name.value);
    },
    Field: (node, key, parent) => {
      parent && fields.add(node.alias?.value || node.name.value);
    },
  });
  return `{ ${Array.from(fields).join(' ')} }`;
}

export function createChildSelectionSet(
  queryFieldNode: FieldNode
): readonly SelectionNode[] {
  return visit(queryFieldNode, {
    Field: node => ({...node, alias: undefined}),
  }).selectionSet.selections;
}

export function createArgsFromKeysFunction(queryFieldNode: FieldNode) {
  return (parents: readonly unknown[]) => {
    const args = visit(queryFieldNode, {
      leave: {
        Argument: node => ({[node.name.value]: node.value}),
        ObjectValue: node =>
          node.fields.reduce((obj, field) => {
            obj[field.name.value] = field.value;
            return obj;
          }, {} as Record<string, unknown>),
        ListValue: node => node.values,
        Variable: node =>
          _(parents)
            .map(parent => _.get(parent, node.name.value))
            .uniq()
            .filter(val => val)
            .value(),
      },
    }).arguments;
    return _.merge({}, ...args);
  };
}

type Entity = any;
export function mapChildrenToParents(
  children: readonly Entity[],
  parents: readonly Entity[],
  queryFieldNode: FieldNode,
  returnType: GraphQLOutputType
) {
  const childKeyFields: string[] = [];
  const parentKeyFields: string[] = [];
  visit(queryFieldNode, {
    Field: (node, key, parent) => {
      parent && childKeyFields.push(node.name.value);
      parent && parentKeyFields.push(node.alias?.value || node.name.value);
    },
  });
  const toManyRelation =
    isListType(returnType) ||
    (isNonNullType(returnType) && isListType(returnType.ofType));
  const hashFn = (entity: Record<string, Entity>, keyFields: string[]) =>
    childKeyFields.length === 1
      ? entity[keyFields[0]]
      : JSON.stringify(_.at(entity, keyFields));
  const childrenByKey = _.groupBy(children, child =>
    hashFn(child, childKeyFields)
  );
  return parents
    .map(parent => childrenByKey[hashFn(parent, parentKeyFields)])
    .map(group => (toManyRelation ? group ?? [] : group?.[0] ?? null));
}
