import {
  FieldNode,
  GraphQLSchema,
  isListType,
  Kind,
  parse,
  SelectionNode,
  visit,
} from 'graphql';
import {batchDelegateToSchema} from '@graphql-tools/batch-delegate';
import {Transform} from '@graphql-tools/delegate';
import {stitchSchemas} from '@graphql-tools/stitch';
import {IResolvers} from '@graphql-tools/utils';
import {WrapQuery} from '@graphql-tools/wrap';
import _ from 'lodash';

export interface GraphQLJoinConfig {
  typedefs: string;
  resolvers: {
    [type: string]: {
      [field: string]: {
        joinQuery: string;
      };
    };
  };
}

export default class GraphQLJoin implements Transform {
  private transformedSchema: GraphQLSchema | null = null;
  constructor(private config: GraphQLJoinConfig) {}

  public transformSchema(originalWrappingSchema: GraphQLSchema) {
    this.transformedSchema = stitchSchemas({
      subschemas: [originalWrappingSchema],
      typeDefs: this.config.typedefs,
      resolvers: this.createResolvers(this.config.resolvers),
    });
    return this.transformedSchema;
  }

  private createResolvers(resolversConfig: GraphQLJoinConfig['resolvers']) {
    return _.mapValues(resolversConfig, typeConfig =>
      _.mapValues(typeConfig, fieldConfig => {
        const def = parse(`{${fieldConfig.joinQuery}}`).definitions[0];
        const queryFieldNode =
          def.kind === Kind.OPERATION_DEFINITION &&
          def.selectionSet.selections[0].kind === Kind.FIELD &&
          def.selectionSet.selections[0];
        if (!queryFieldNode) throw Error('invalid joinQuery config');
        const fieldName = getQueryName(queryFieldNode);
        const keyMapping = createKeyMapping(queryFieldNode);
        const argsFromKeys = createArgsFromKeysFunction(queryFieldNode);
        const childSelectionSetTransform = addRequiredChildFieldsToRequest(
          fieldName,
          keyMapping
        );
        return {
          selectionSet: createSelectionSet(queryFieldNode),
          resolve: (parent, args, context, info) =>
            batchDelegateToSchema({
              schema: this.transformedSchema!,
              operation: 'query',
              fieldName,
              key: parent,
              argsFromKeys,
              valuesFromResults: (results, keys) =>
                mapChildrenToParents(
                  results,
                  keys,
                  keyMapping,
                  isListType(info.returnType)
                ),
              context,
              info,
              transforms: [childSelectionSetTransform],
            }),
        } as IResolvers;
      })
    );
  }
}

export function createKeyMapping(queryFieldNode: FieldNode) {
  const mapping = {} as Record<string, string>;
  visit(queryFieldNode, {
    Field: (node, key, parent) =>
      parent &&
      (mapping[node.name.value] = node.alias?.value || node.name.value),
  });
  return mapping;
}

export function createSelectionSet(queryFieldNode: FieldNode) {
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

export function mapChildrenToParents(
  children: readonly any[],
  parents: readonly any[],
  keyMapping: Record<string, string>,
  isList: boolean
) {
  const childKeyFields = Object.keys(keyMapping);
  const parentKeyFields = Object.values(keyMapping);
  if (childKeyFields.length === 1) {
    const entitiesByKey = _.groupBy(
      children,
      entity => entity[childKeyFields[0]]
    );
    return parents
      .map(root => entitiesByKey[root[parentKeyFields[0]]])
      .map(group => (isList ? group ?? [] : group?.[0] ?? null));
  } else {
    const entitiesByKey = _.groupBy(children, entity =>
      JSON.stringify(_.at(entity, childKeyFields))
    );
    return parents
      .map(root => entitiesByKey[JSON.stringify(_.at(root, parentKeyFields))])
      .map(group => (isList ? group ?? [] : group?.[0] ?? null));
  }
}

export function addRequiredChildFieldsToRequest(
  parentFieldName: string,
  keyMapping: Record<string, string>
) {
  return new WrapQuery(
    [parentFieldName],
    selectionSet => {
      Object.keys(keyMapping).forEach(keyField =>
        (selectionSet.selections as SelectionNode[]).push({
          kind: Kind.FIELD,
          name: {
            kind: Kind.NAME,
            value: keyField,
          },
        })
      );
      return selectionSet;
    },
    result => result
  );
}
