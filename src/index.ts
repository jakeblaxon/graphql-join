import {GraphQLSchema, isListType, Kind} from 'graphql';
import {
  BatchDelegateOptions,
  batchDelegateToSchema,
} from '@graphql-tools/batch-delegate';
import {AddSelectionSets, Transform} from '@graphql-tools/delegate';
import {stitchSchemas} from '@graphql-tools/stitch';
import {IResolvers} from '@graphql-tools/utils';
import * as _ from 'lodash';
import {WrapQuery} from '@graphql-tools/wrap';

type PossibleArray<T> = T | T[];

type JoinMapping = PossibleArray<{
  parent: string;
  child: string;
}>;

interface GraphQLJoinConfig {
  typedefs: string;
  resolvers: {
    [type: string]: {
      [field: string]: {
        selectionSet: string;
        queryName: string;
        args: BatchDelegateOptions['argsFromKeys'];
        joinOn: JoinMapping;
      };
    };
  };
}

export default class GraphQLJoin implements Transform {
  constructor(private config: GraphQLJoinConfig) {}

  public transformSchema(originalWrappingSchema: GraphQLSchema) {
    return stitchSchemas({
      subschemas: [originalWrappingSchema],
      typeDefs: this.config.typedefs,
      resolvers: createResolvers(this.config.resolvers),
    });
  }
}

const createResolvers = (resolversConfig: GraphQLJoinConfig['resolvers']) =>
  _.mapValues(resolversConfig, (typeConfig, type) =>
    _.mapValues(typeConfig, (fieldConfig, field) => {
      const selectChildKeys = addChildKeyFieldsToSelectionSetTransform(
        field,
        _.isArray(fieldConfig.joinOn)
          ? fieldConfig.joinOn.map(mapping => mapping.child)
          : [fieldConfig.joinOn.child]
      );
      return {
        selectionSet: fieldConfig.selectionSet,
        resolve: (parent, args, context, info) =>
          batchDelegateToSchema({
            schema: info.schema,
            operation: 'query',
            fieldName: fieldConfig.queryName,
            key: parent,
            argsFromKeys: fieldConfig.args,
            valuesFromResults: (results, keys) =>
              mapChildrenToParents(
                results,
                keys,
                fieldConfig.joinOn,
                isListType(info.returnType)
              ),
            context,
            info,
            transforms: [selectChildKeys],
          }),
      } as IResolvers;
    })
  );

export const addChildKeyFieldsToSelectionSetTransform = (
  queryName: string,
  childKeys: string[]
) =>
  new WrapQuery(
    [queryName],
    selectionSet => {
      const a = {
        ...selectionSet,
        selections: selectionSet.selections.concat(
          childKeys.map(key => ({
            kind: Kind.FIELD,
            name: {
              kind: Kind.NAME,
              value: key,
            },
          }))
        ),
      };
      console.log(JSON.stringify(a, null, 2));
      return a;
    },
    result => {
      console.log(result);
      return result;
    }
  );

export const mapChildrenToParents = (
  children: any[],
  parents: readonly any[],
  joinMapping: JoinMapping,
  listType: boolean
) => {
  if (!_.isArray(joinMapping)) {
    const keyToChildren = _.groupBy(
      children,
      child => child[joinMapping.child]
    );
    return parents.map(
      listType
        ? keyToChildren[joinMapping.parent]
        : keyToChildren[joinMapping.parent][0]
    );
  } else {
    return children;
  }
};
