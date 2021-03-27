import {
  DocumentNode,
  FieldNode,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLNullableType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLType,
  isInputObjectType,
  isLeafType,
  isWrappingType,
  Kind,
  NamedTypeNode,
  OperationDefinitionNode,
  VariableDefinitionNode,
  parse,
  TypeNode,
  validate,
  visit,
  ObjectTypeDefinitionNode,
} from 'graphql';

export function validateFieldConfig(
  fieldConfig: string,
  typeName: string,
  field: string,
  typeDefs: string,
  schema: GraphQLSchema
) {
  //   const returnType = schema.getQueryType()?.getFields()[queryNode.name.value]
  //     ?.type;
  //   if (!returnType) throw Error();
  //   const leafReturnType = getLeafType(returnType);

  const document = parse(`{${fieldConfig}}`);
  const operationDefinition =
    document.definitions[0].kind === Kind.OPERATION_DEFINITION &&
    document.definitions[0];
  if (!operationDefinition) throw Error();

  const typeNode = schema.getType(typeName)?.astNode;
  if (typeNode?.kind !== Kind.OBJECT_TYPE_DEFINITION) throw Error();

  const newOperationDefinition = {
    ...operationDefinition,
    variableDefinitions: createVariableDefinitions(
      operationDefinition,
      typeNode
    ),
  };

  const newDocument = {
    ...document,
    definitions: [newOperationDefinition],
  };

  const errors = validate(schema, newDocument);
  console.log(errors);

  return getQueryFieldNode(fieldConfig);
}

function getQueryFieldNode(fieldConfig: string) {
  const document = parse(`{${fieldConfig}}`);
  const queryFieldNode =
    document.definitions[0].kind === Kind.OPERATION_DEFINITION &&
    document.definitions[0].selectionSet.selections[0].kind === Kind.FIELD &&
    document.definitions[0].selectionSet.selections[0];
  if (!queryFieldNode) throw Error('invalid joinQuery config');
  return queryFieldNode;
}

function createVariableDefinitions(
  operationDefinition: OperationDefinitionNode,
  typeNode: ObjectTypeDefinitionNode
): Array<VariableDefinitionNode> {
  const variableNames = new Set<string>();
  visit(operationDefinition, {
    Variable: node => {
      variableNames.add(node.name.value);
    },
  });
  return Array.from(variableNames).map(variableName => {
    const fieldNode = typeNode.fields?.find(
      field => field.name.value === variableName
    );
    if (!fieldNode) throw Error();
    return {
      kind: Kind.VARIABLE_DEFINITION,
      variable: {
        kind: Kind.VARIABLE,
        name: {
          kind: Kind.NAME,
          value: variableName,
        },
      },
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: {
            kind: Kind.NON_NULL_TYPE,
            type: {
              kind: Kind.NAMED_TYPE,
              name: {
                kind: Kind.NAME,
                value: unwrapType(fieldNode.type).name.value,
              },
            },
          },
        },
      },
    };
  });
}

function unwrapType(type: TypeNode): NamedTypeNode {
  return type.kind === Kind.LIST_TYPE || type.kind === Kind.NON_NULL_TYPE
    ? unwrapType(type.type)
    : type;
}
