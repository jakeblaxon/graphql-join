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

interface GraphQLMeshConfig {
  config: GraphQLJoinConfig;
}

export default class GraphQLJoinTransform implements Transform {
  constructor(private config: GraphQLJoinConfig) {}

  public transformSchema(originalSchema: GraphQLSchema) {
    const {typeDefs, resolvers} =
      ((this.config as any) as GraphQLMeshConfig).config || this.config;
    return stitchSchemas({
      subschemas: [originalSchema],
      typeDefs,
      resolvers: _.mapValues(resolvers, (typeConfig, typeName) =>
        _.mapValues(typeConfig, (fieldConfig, fieldName) => {
          return createFieldResolver(
            validateFieldConfig(
              fieldConfig,
              typeName,
              fieldName,
              typeDefs,
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

export function mapChildrenToParents(
  children: readonly Record<string, unknown>[],
  parents: readonly Record<string, unknown>[],
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
  if (childKeyFields.length === 1) {
    const childrenByKey = _(children)
      .flatMap(child =>
        _([child[childKeyFields[0]]])
          .flatten()
          .map(key => ({key, child}))
          .value()
      )
      .groupBy(pair => pair.key)
      .mapValues(pairs => pairs.map(pair => pair.child))
      .value();
    return parents
      .map(parent =>
        _([parent[parentKeyFields[0]]])
          .flatten()
          .flatMap(key => (key === null ? [] : childrenByKey[key as any] || []))
          .uniq()
          .value()
      )
      .map(group => (toManyRelation ? group || [] : group?.[0] ?? null));
  } else {
    const childrenByKey = _.groupBy(children, child =>
      JSON.stringify(_.at(child, childKeyFields))
    );
    return parents
      .map(prnt => childrenByKey[JSON.stringify(_.at(prnt, parentKeyFields))])
      .map(group => (toManyRelation ? group || [] : group?.[0] ?? null));
  }
}
