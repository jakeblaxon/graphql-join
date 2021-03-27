import {
  GraphQLSchema,
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

  const typeNode = schema.getType(typeName)?.astNode;
  if (typeNode?.kind !== Kind.OBJECT_TYPE_DEFINITION) throw Error();

  let variableDefinitions;
  try {
    variableDefinitions = createVariableDefinitions(
      operationDefinition,
      typeNode
    );
  } catch (e) {
    throw new ValidationError(e);
  }

  const newDocument = {
    ...document,
    definitions: [
      {
        ...operationDefinition,
        variableDefinitions,
      },
    ],
  };

  const errors = validate(schema, newDocument);
  if (errors.length > 0) throw new ValidationError(errors[0].message);

  const queryFieldNode =
    operationDefinition.selectionSet.selections[0].kind === Kind.FIELD &&
    operationDefinition.selectionSet.selections[0];
  if (!queryFieldNode) throw Error();

  return queryFieldNode;
}

//   const returnType = schema.getQueryType()?.getFields()[queryNode.name.value]
//     ?.type;
//   if (!returnType) throw Error();
//   const leafReturnType = getLeafType(returnType);

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

function unwrapType(type: TypeNode): NamedTypeNode {
  return type.kind === Kind.LIST_TYPE || type.kind === Kind.NON_NULL_TYPE
    ? unwrapType(type.type)
    : type;
}
