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
  isScalarType,
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
    const childType = validateReturnType(
      queryFieldNode,
      typeName,
      fieldName,
      typeDefs,
      schema
    );
    validateSelections(queryFieldNode, typeNode, childType);
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

function validateReturnType(
  queryFieldNode: FieldNode,
  typeName: string,
  fieldName: string,
  typeDefs: string,
  schema: GraphQLSchema
) {
  const returnType = schema.getQueryType()?.getFields()[
    queryFieldNode.name.value
  ]?.type;
  if (!returnType) throw new Error('Could not find return type for query.');
  const unwrappedReturnType = unwrapType(returnType);
  if (!isObjectType(unwrappedReturnType))
    throw Error(
      `Query must return an object or list of objects but instead returns ${returnType.toString()}.`
    );
  let typeDefsDocument;
  try {
    typeDefsDocument = parse(typeDefs);
  } catch (e) {
    throw Error(`typeDefs is invalid: ${e}`);
  }
  let intendedType;
  visit(typeDefsDocument, {
    ObjectTypeDefinition: node => (node.name.value === typeName ? node : false),
    ObjectTypeExtension: node => (node.name.value === typeName ? node : false),
    FieldDefinition: node =>
      node.name.value === fieldName ? (intendedType = node.type) : undefined,
  });
  if (!intendedType)
    throw Error(`Field [${typeName}.${fieldName}] not found in typeDefs.`);
  if (unwrapTypeNode(intendedType).name.value !== unwrappedReturnType.name)
    throw Error(
      `Query does not return the intended entity type ${
        unwrapTypeNode(intendedType).name.value
      } for [${typeName}.${fieldName}]. Returns ${returnType.toString()}.`
    );
  return unwrappedReturnType;
}

function validateSelections(
  queryFieldNode: FieldNode,
  typeNode: ObjectTypeDefinitionNode,
  childType: GraphQLObjectType
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
    const childFieldType = childType.getFields()[selection.name.value]?.type;
    if (!childFieldType)
      throw Error(
        `Could not find type definition for [${childType.name}.${selection.name.value}].`
      );
    if (!isScalarType(unwrapType(childFieldType)))
      throw Error(
        `Cannot join on key [${childType.name}.${selection.name.value}]. Join keys must be scalars or scalar lists.`
      );
    if (
      unwrapType(childFieldType).name !==
      unwrapTypeNode(parentFieldNode.type).name.value
    )
      throw Error(
        `Cannot join on keys [${typeNode.name.value}.${parentFieldName}] and [${
          childType.name
        }.${selection.name.value}]. They are different types: ${
          unwrapTypeNode(parentFieldNode.type).name.value
        } and ${unwrapType(childFieldType).name}.`
      );
  });
}

function unwrapTypeNode(type: TypeNode): NamedTypeNode {
  return type.kind === Kind.LIST_TYPE || type.kind === Kind.NON_NULL_TYPE
    ? unwrapTypeNode(type.type)
    : type;
}

function unwrapType(
  type: GraphQLOutputType
):
  | GraphQLScalarType
  | GraphQLObjectType
  | GraphQLInterfaceType
  | GraphQLUnionType
  | GraphQLEnumType {
  return type && isWrappingType(type) ? unwrapType(type.ofType) : type;
}
