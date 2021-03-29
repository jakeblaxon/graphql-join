import {
  FieldNode,
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
          mapChildrenToParents(
            results,
            keys,
            queryFieldNode,
            isListType(info.returnType) ||
              (isNonNullType(info.returnType) &&
                isListType(info.returnType.ofType))
          ),
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
  const scalarSymbol = Symbol('Scalar');
  const getValue = (node: {value: {kind: unknown; value?: unknown}}) =>
    node.value.kind === scalarSymbol ? node.value.value : node.value;
  return (parents: readonly unknown[]) => {
    const args = visit(queryFieldNode, {
      leave: {
        IntValue: node => ({kind: scalarSymbol, value: parseInt(node.value)}),
        FloatValue: node => ({kind: scalarSymbol, value: Number(node.value)}),
        StringValue: node => ({kind: scalarSymbol, value: node.value}),
        EnumValue: node => ({kind: scalarSymbol, value: node.value}),
        BooleanValue: node => ({kind: scalarSymbol, value: node.value}),
        NullValue: () => ({kind: scalarSymbol, value: null}),
        Argument: node => ({[node.name.value]: getValue(node)}),
        ListValue: node => node.values.map(value => getValue({value})),
        ObjectValue: node =>
          _(node.fields)
            .keyBy(field => field.name.value)
            .mapValues(getValue)
            .value(),
        Variable: node =>
          _(parents)
            .flatMap(parent => _.get(parent, node.name.value))
            .filter(elt => elt !== null && elt !== undefined)
            .uniq()
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
  toManyRelation: boolean
) {
  const childKeyFields: string[] = [];
  const parentKeyFields: string[] = [];
  visit(queryFieldNode, {
    Field: (node, key, parent) => {
      parent && childKeyFields.push(node.name.value);
      parent && parentKeyFields.push(node.alias?.value || node.name.value);
    },
  });
  const hashFn = (entity: Record<string, Entity>, keyFields: string[]) =>
    childKeyFields.length === 1
      ? entity[keyFields[0]]
      : JSON.stringify(_.at(entity, keyFields));
  const childrenKeyPairs = children.map(child => ({
    child,
    keyOrKeyList: hashFn(child, childKeyFields),
  }));
  const childKeyIsList = _.some(childrenKeyPairs, pair =>
    _.isArray(pair.keyOrKeyList)
  );
  const childrenByKey = _(childrenKeyPairs)
    .flatMap(pair =>
      childKeyIsList
        ? (pair.keyOrKeyList || []).map((value: any) => ({
            key: value,
            value: pair.child,
          }))
        : {key: pair.keyOrKeyList, value: pair.child}
    )
    .groupBy(childKeyPair => childKeyPair.key)
    .mapValues(group => group.map(elt => elt.value))
    .value();

  const parentKeyPairs = parents.map(parent => ({
    parent,
    keyOrKeyList: hashFn(parent, parentKeyFields),
  }));
  const parentKeyIsList = _.some(parentKeyPairs, pair =>
    _.isArray(pair.keyOrKeyList)
  );
  return parentKeyPairs
    .map(pair =>
      parentKeyIsList
        ? _(pair.keyOrKeyList || [])
            .flatMap((key: any) => childrenByKey[key])
            .uniq()
            .value()
        : childrenByKey[pair.keyOrKeyList]
    )
    .map(group => (toManyRelation ? group ?? [] : group?.[0] ?? null));
}
