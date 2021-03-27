import {
  GraphQLSchema,
  Kind,
  NamedTypeNode,
  parse,
  TypeNode,
  validate,
  visit,
  ObjectTypeDefinitionNode,
  FieldNode,
  isObjectType,
  GraphQLOutputType,
  isWrappingType,
  GraphQLScalarType,
  GraphQLObjectType,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLEnumType,
  DocumentNode,
  OperationDefinitionNode,
} from 'graphql';

export function validateFieldConfig(
  fieldConfig: string,
  typeName: string,
  fieldName: string,
  typeDefs: string,
  schema: GraphQLSchema
) {
  class ValidationError extends Error {
    constructor(message: string) {
      super(
        `graphql-join config error for resolver [${typeName}.${fieldName}]: ${message}`
      );
    }
  }

  let document;
  try {
    document = parse(`{${fieldConfig}}`);
  } catch (e) {
    throw new ValidationError(e);
  }
  const operationDefinition = document.definitions[0];
  if (operationDefinition?.kind !== Kind.OPERATION_DEFINITION)
    throw new ValidationError('Unable to find operation definition for query.');
  if (operationDefinition.selectionSet.selections.length > 1)
    throw new ValidationError('Only one query field is allowed.');
  const queryFieldNode = operationDefinition.selectionSet.selections[0];
  if (queryFieldNode?.kind !== Kind.FIELD)
    throw new ValidationError('Query type must be a field node.');
  const typeNode = schema.getType(typeName)?.astNode;
  if (typeNode?.kind !== Kind.OBJECT_TYPE_DEFINITION)
    throw new ValidationError(`Type ${typeName} must be an object type.`);

  try {
    validateArguments(operationDefinition, typeNode, document, schema);
    validateReturnType(queryFieldNode, schema);
    validateSelections(queryFieldNode, typeNode, schema);
  } catch (e) {
    throw new ValidationError(e.message);
  }

  return queryFieldNode;
}

function validateArguments(
  operationDefinition: OperationDefinitionNode,
  typeNode: ObjectTypeDefinitionNode,
  document: DocumentNode,
  schema: GraphQLSchema
) {
  const variableNames = new Set<string>();
  visit(operationDefinition, {
    Variable: node => {
      variableNames.add(node.name.value);
    },
  });
  const variableDefinitions = Array.from(variableNames).map(variableName => {
    const fieldNode = typeNode.fields?.find(
      field => field.name.value === variableName
    );
    if (!fieldNode)
      throw Error(
        `Field corresponding to $${variableName} not found in type ${typeNode.name.value}.`
      );
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
                value: unwrapTypeNode(fieldNode.type).name.value,
              },
            },
          },
        },
      },
    };
  });
  const errors = validate(schema, {
    ...document,
    definitions: [
      {
        ...operationDefinition,
        variableDefinitions,
      },
    ],
  });
  if (errors.length > 0) throw new Error(errors[0].message);
}

function validateReturnType(queryFieldNode: FieldNode, schema: GraphQLSchema) {
  const returnType = unwrapType(
    schema.getQueryType()?.getFields()[queryFieldNode.name.value]?.type
  );
  if (!returnType || !isObjectType(returnType))
    throw Error(
      `Query must return an object or list of objects but instead returns ${returnType}`
    );
}

function validateSelections(
  queryFieldNode: FieldNode,
  typeNode: ObjectTypeDefinitionNode,
  schema: GraphQLSchema
) {
  queryFieldNode.selectionSet?.selections.forEach(selection => {
    if (selection.kind !== Kind.FIELD) throw Error();
    const parentFieldName = selection.alias?.value || selection.name.value;
    const parentFieldNode = typeNode.fields?.find(
      field => field.name.value === parentFieldName
    );
    if (!parentFieldNode)
      throw Error(
        `Field corresponding to [${parentFieldName}] in selection set not found in type [${
          typeNode.name.value
        }]. ${
          selection.alias
            ? 'Make sure the alias is correctly spelled.'
            : 'Use an alias to map the child field to the corresponding parent field.'
        }`
      );
    // const unwrappedReturnType = unwrapType(returnType.);
    // const leafReturnType = getLeafType(returnType);
    //     const childFieldNode = schema.getType(t).fields?.find(
    //       field => field.name.value === parentFieldName
    //     );
    //   unwrapType(parentFieldNode.type).name.value !== unwrapType(selection.)
  });
}

function unwrapTypeNode(type: TypeNode): NamedTypeNode {
  return type.kind === Kind.LIST_TYPE || type.kind === Kind.NON_NULL_TYPE
    ? unwrapTypeNode(type.type)
    : type;
}

function unwrapType(
  type: GraphQLOutputType | undefined
):
  | GraphQLScalarType
  | GraphQLObjectType
  | GraphQLInterfaceType
  | GraphQLUnionType
  | GraphQLEnumType
  | undefined {
  return type && isWrappingType(type) ? unwrapType(type.ofType) : type;
}
