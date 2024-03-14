import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  UnknownRow,
} from "kysely";
import {
  OperationNodeTransformer,
  type RootOperationNode,
  TableNode,
} from "kysely";

// Custom transformer that appends "_raw_" prefix to table names
class WithTablePrefixTransformer extends OperationNodeTransformer {
  readonly #prefix: string;

  constructor(prefix: string) {
    super();
    this.#prefix = prefix;
  }

  protected override transformTable(node: TableNode): TableNode {
    if (node.table && !node.table.identifier.name.startsWith(this.#prefix)) {
      return TableNode.create(`${this.#prefix}${node.table.identifier.name}`);
    }
    return node;
  }
}

// Plugin class using the WithTablePrefixTransformer
export class WithTablePrefixPlugin implements KyselyPlugin {
  readonly #transformer: WithTablePrefixTransformer;

  constructor(prefix: string) {
    this.#transformer = new WithTablePrefixTransformer(prefix);
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    // Use the transformer to modify the query's operation node
    return this.#transformer.transformNode(args.node);
  }

  transformResult(
    args: PluginTransformResultArgs,
  ): Promise<QueryResult<UnknownRow>> {
    // No modification to the result in this plugin
    return Promise.resolve(args.result);
  }
}
