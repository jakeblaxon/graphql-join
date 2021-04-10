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
  isListType,
  isNonNullType,
  buildSchema,
  printSchema,
  print,
  specifiedRules,
  NoUnusedVariablesRule,
  ScalarLeafsRule,
} from 'graphql';

export function validateFieldConfig(
  fieldConfig: string,
  typeName: string,
  fieldName: string,
  typeDefs: string,
  schema: GraphQLSchema
) {
  return new Validator(
    fieldConfig,
    typeName,
    fieldName,
    typeDefs,
    schema
  ).validate();
}

class Validator {
  private document: DocumentNode;
  private operationDefinition: OperationDefinitionNode;
  private queryFieldNode: FieldNode;
  private typeNode: ObjectTypeDefinitionNode;
  private childType: GraphQLObjectType | null;
  private isUnbatched: boolean;

  constructor(
    private fieldConfig: string,
    private typeName: string,
    private fieldName: string,
    private typeDefs: string,
    private schema: GraphQLSchema
  ) {
    // rebuild schema, as its ast nodes may be undefined
    this.schema = buildSchema(printSchema(schema));

    let document: DocumentNode;
    try {
      document = parse(`{${fieldConfig}}`);
    } catch (e) {
      throw this.error(e);
    }
    this.isUnbatched = false;
    this.document = visit(document, {
      Directive: node =>
        node.name.value === 'unbatched'
          ? (this.isUnbatched = true) && null
          : undefined,
    });
    if (this.isUnbatched)
      this.warn(
        'Use of unbatched queries is not recommended as it results in the n+1 problem.'
      );

    const operationDefinition = this.document.definitions[0];
    if (operationDefinition?.kind !== Kind.OPERATION_DEFINITION)
      throw this.error('Unable to find operation definition for query.');
    if (operationDefinition.selectionSet.selections.length > 1)
      throw this.error('Multiple queries or fragments are not allowed.');
    this.operationDefinition = operationDefinition;

    const queryFieldNode = operationDefinition.selectionSet.selections[0];
    if (queryFieldNode?.kind !== Kind.FIELD)
      throw this.error('Query type must be a field node.');
    this.queryFieldNode = queryFieldNode;

    const typeNode = this.schema.getType(typeName)?.astNode;
    if (typeNode?.kind !== Kind.OBJECT_TYPE_DEFINITION)
      throw this.error(`Type "${typeName}" must be an object type.`);
    this.typeNode = typeNode;

    this.validateArguments();
    this.childType = this.validateReturnType();
    this.validateSelections();
  }

  validate() {
    return this.queryFieldNode;
  }

  private validateArguments() {
    const variableNames = new Set<string>();
    visit(this.operationDefinition, {
      Variable: node => {
        variableNames.add(node.name.value);
      },
    });
    const variableDefinitions = Array.from(variableNames).map(variableName => {
      const fieldNode = this.typeNode.fields?.find(
        field => field.name.value === variableName
      );
      if (!fieldNode)
        throw this.error(
          `Field corresponding to "$${variableName}" not found in type "${this.typeNode.name.value}".`
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
        type: this.isUnbatched
          ? fieldNode.type
          : {
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
    const errors = validate(
      this.schema,
      visit(this.document, {
        OperationDefinition: node => ({...node, variableDefinitions}),
      }),
      specifiedRules
        .filter(rule => rule !== NoUnusedVariablesRule)
        .filter(rule => (this.isUnbatched ? rule !== ScalarLeafsRule : true))
    );
    if (errors.length > 0) throw this.error(errors[0].message);
  }

  private validateReturnType() {
    const returnType = this.schema.getQueryType()?.getFields()[
      this.queryFieldNode.name.value
    ]?.type;
    if (!returnType) throw this.error('Could not find return type for query.');
    let typeDefsDocument;
    try {
      typeDefsDocument = parse(this.typeDefs);
    } catch (e) {
      throw this.error(`typeDefs is invalid: ${e}`);
    }
    let intendedType: TypeNode | undefined;
    visit(typeDefsDocument, {
      ObjectTypeDefinition: node =>
        node.name.value === this.typeName ? node : false,
      ObjectTypeExtension: node =>
        node.name.value === this.typeName ? node : false,
      FieldDefinition: node =>
        node.name.value === this.fieldName
          ? (intendedType = node.type)
          : undefined,
    });
    if (!intendedType)
      throw this.error(
        `Field "${this.typeName}.${this.fieldName}" not found in typeDefs.`
      );

    if (unwrapTypeNode(intendedType).name.value !== unwrapType(returnType).name)
      throw this.error(
        this.isUnbatched
          ? `Query does not return the intended type "${print(
              intendedType
            )}" for "${this.typeName}.${
              this.fieldName
            }". Returns "${returnType}".`
          : `Query does not return the intended entity type "${
              unwrapTypeNode(intendedType).name.value
            }" for "${this.typeName}.${
              this.fieldName
            }". Returns "${returnType}".`
      );
    if (this.isUnbatched) return null;
    const unwrappedReturnType = unwrapType(returnType);
    if (
      !isListType(isNonNullType(returnType) ? returnType.ofType : returnType) ||
      !isObjectType(unwrappedReturnType)
    )
      throw this.error(
        `Query must return a list of objects but instead returns "${returnType}".`
      );
    return unwrappedReturnType;
  }

  private validateSelections() {
    const selections = this.queryFieldNode.selectionSet?.selections;
    if (this.isUnbatched) {
      if (selections?.length)
        throw this.error(
          'Selection sets for unbatched queries are unnecessary.'
        );
      return;
    }
    if (!selections) throw this.error('Query must have a selection set.');
    selections.forEach(selection => {
      if (selection.kind !== Kind.FIELD)
        throw this.error('Fragments are not allowed in query.');
      const parentFieldName = selection.alias?.value || selection.name.value;
      const parentFieldNode = this.typeNode.fields?.find(
        field => field.name.value === parentFieldName
      );
      if (!parentFieldNode)
        throw this.error(
          `Field corresponding to "${parentFieldName}" in selection set not found in type "${
            this.typeNode.name.value
          }". ${
            selection.alias
              ? 'Make sure the alias is correctly spelled.'
              : 'Use an alias to map the child field to the corresponding parent field.'
          }`
        );
      if (parentFieldNode.type.kind === Kind.LIST_TYPE && selections.length > 1)
        throw this.error(
          `Only one selection field is allowed when joining on a list type like "${this.typeNode.name.value}.${parentFieldName}".`
        );
      const childFieldName = selection.name.value;
      if (!this.childType)
        throw this.error('Cannot find the child type in the schema.');
      const childFieldType = this.childType.getFields()[childFieldName]?.type;
      if (!childFieldType)
        throw this.error(
          `Could not find type definition for "${this.childType.name}.${childFieldName}".`
        );
      if (isListType(childFieldType) && selections.length > 1)
        throw this.error(
          `Only one selection field is allowed when joining on a list type like "${this.childType.name}.${childFieldName}".`
        );
      if (!isScalarType(unwrapType(childFieldType)))
        throw this.error(
          `Cannot join on key "${this.childType.name}.${childFieldName}". Join keys must be scalars or scalar lists.`
        );
      if (
        unwrapType(childFieldType).name !==
        unwrapTypeNode(parentFieldNode.type).name.value
      )
        throw this.error(
          `Cannot join on keys "${
            this.typeNode.name.value
          }.${parentFieldName}" and "${
            this.childType.name
          }.${childFieldName}". They are different types: "${
            unwrapTypeNode(parentFieldNode.type).name.value
          }" and "${unwrapType(childFieldType).name}".`
        );
    });
  }

  private warn(message: string) {
    console.warn(
      `graphql-join warning for resolver "${this.typeName}.${this.fieldName}": ${message}`
    );
  }
  private error(message: string) {
    return new Error(
      `graphql-join config error for resolver "${this.typeName}.${this.fieldName}": ${message}`
    );
  }
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
