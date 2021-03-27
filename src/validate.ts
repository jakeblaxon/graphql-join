import {
  GraphQLSchema,
  Kind,
  NamedTypeNode,
  VariableDefinitionNode,
  parse,
  TypeNode,
  validate,
  visit,
  ObjectTypeDefinitionNode,
  FieldNode,
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
  const operationDefinition =
    document.definitions[0].kind === Kind.OPERATION_DEFINITION &&
    document.definitions[0];
  if (!operationDefinition)
    throw new ValidationError('Unable to find operation definition for query.');
  if (operationDefinition.selectionSet.selections.length > 1)
    throw new ValidationError('Only one query field is allowed.');
  const queryFieldNode = operationDefinition.selectionSet.selections[0];
  if (!queryFieldNode || queryFieldNode.kind !== Kind.FIELD)
    throw new ValidationError('Query type must be a field node.');
  const typeNode = schema.getType(typeName)?.astNode;
  if (typeNode?.kind !== Kind.OBJECT_TYPE_DEFINITION)
    throw new ValidationError(`Type ${typeName} must be an object type.`);

  let variableDefinitions;
  try {
    variableDefinitions = createVariableDefinitions(queryFieldNode, typeNode);
  } catch (e) {
    throw new ValidationError(e);
  }

  const errors = validate(schema, {
    ...document,
    definitions: [
      {
        ...operationDefinition,
        variableDefinitions,
      },
    ],
  });
  if (errors.length > 0) throw new ValidationError(errors[0].message);

  try {
    validateSelections(queryFieldNode, typeNode);
  } catch (e) {
    throw new ValidationError(e);
  }

  return queryFieldNode;
}

//   const returnType = schema.getQueryType()?.getFields()[queryNode.name.value]
//     ?.type;
//   if (!returnType) throw Error();
//   const leafReturnType = getLeafType(returnType);

function createVariableDefinitions(
  queryFieldNode: FieldNode,
  typeNode: ObjectTypeDefinitionNode
): Array<VariableDefinitionNode> {
  const variableNames = new Set<string>();
  visit(queryFieldNode, {
    Variable: node => {
      variableNames.add(node.name.value);
    },
  });
  return Array.from(variableNames).map(variableName => {
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
                value: unwrapType(fieldNode.type).name.value,
              },
            },
          },
        },
      },
    };
  });
}

function validateSelections(
  queryFieldNode: FieldNode,
  typeNode: ObjectTypeDefinitionNode
) {
  queryFieldNode.selectionSet?.selections.forEach(selection => {
    if (selection.kind !== Kind.FIELD) throw Error();
    const parentFieldName = selection.alias?.value || selection.name.value;
    const fieldNode = typeNode.fields?.find(
      field => field.name.value === parentFieldName
    );
    if (!fieldNode)
      throw Error(
        `Field corresponding to [${parentFieldName}] in selection set not found in type [${
          typeNode.name.value
        }]. ${
          selection.alias
            ? 'Make sure the alias is correctly spelled.'
            : 'Use an alias to map the child field to the corresponding parent field.'
        }`
      );
  });
}

function unwrapType(type: TypeNode): NamedTypeNode {
  return type.kind === Kind.LIST_TYPE || type.kind === Kind.NON_NULL_TYPE
    ? unwrapType(type.type)
    : type;
}
