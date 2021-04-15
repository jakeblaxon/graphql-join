import {
  FieldNode,
  GraphQLSchema,
  isListType,
  isNonNullType,
  SelectionNode,
  visit,
} from 'graphql';
import {batchDelegateToSchema} from '@graphql-tools/batch-delegate';
import {delegateToSchema, Transform} from '@graphql-tools/delegate';
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
  graphqlTools?: {
    batchDelegateToSchema?: typeof batchDelegateToSchema;
    delegateToSchema?: typeof delegateToSchema;
    stitchSchemas?: typeof stitchSchemas;
  };
}
interface GraphQLMeshConfig {
  config: GraphQLJoinConfig;
}

export default class GraphQLJoinTransform implements Transform {
  private config: GraphQLJoinConfig;

  constructor(config: GraphQLJoinConfig) {
    this.config = ((config as any) as GraphQLMeshConfig).config || config;
  }

  public transformSchema(originalSchema: GraphQLSchema) {
    return (this.config.graphqlTools?.stitchSchemas || stitchSchemas)({
      subschemas: [originalSchema],
      typeDefs: this.config.typeDefs,
      resolvers: this.getResolvers(originalSchema),
    });
  }

  private getResolvers(originalSchema: GraphQLSchema) {
    return _.mapValues(this.config.resolvers, (typeConfig, typeName) =>
      _.mapValues(typeConfig, (fieldConfig, fieldName) => {
        const {queryFieldNode, isUnbatched} = validateFieldConfig(
          fieldConfig,
          typeName,
          fieldName,
          this.config.typeDefs,
          originalSchema
        );
        return isUnbatched
          ? this.createUnbatchedFieldResolver(queryFieldNode, originalSchema)
          : this.createBatchedFieldResolver(queryFieldNode, originalSchema);
      })
    );
  }

  private createUnbatchedFieldResolver(
    queryFieldNode: FieldNode,
    schema: GraphQLSchema
  ) {
    return {
      selectionSet: createParentSelectionSet(queryFieldNode),
      resolve: (parent, args, context, info) =>
        (this.config.graphqlTools?.delegateToSchema || delegateToSchema)({
          schema,
          operation: 'query',
          fieldName: queryFieldNode.name.value,
          context,
          info,
          args: createArgsFromKeysFunction(
            queryFieldNode,
            args,
            false
          )([parent]),
        }),
    } as IResolvers;
  }

  private createBatchedFieldResolver(
    queryFieldNode: FieldNode,
    schema: GraphQLSchema
  ) {
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
        (
          this.config.graphqlTools?.batchDelegateToSchema ||
          batchDelegateToSchema
        )({
          schema,
          operation: 'query',
          fieldName: queryFieldNode.name.value,
          key: parent,
          context,
          info,
          transforms: [childSelectionSetTransform],
          argsFromKeys: createArgsFromKeysFunction(queryFieldNode, args, true),
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
  return fields.size > 0 ? `{ ${Array.from(fields).join(' ')} }` : undefined;
}

export function createChildSelectionSet(
  queryFieldNode: FieldNode
): readonly SelectionNode[] {
  return visit(queryFieldNode, {
    Field: node => ({...node, alias: undefined}),
  }).selectionSet.selections;
}

const scalarSymbol = Symbol('Scalar');
export function createArgsFromKeysFunction(
  queryFieldNode: FieldNode,
  userArgs: Record<string, unknown>,
  batched: boolean
) {
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
          userArgs[node.name.value] ||
          (batched
            ? _(parents)
                .flatMap(parent => _.get(parent, node.name.value))
                .filter(elt => elt !== null && elt !== undefined)
                .uniq()
                .value()
            : _.get(parents[0], node.name.value)),
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
