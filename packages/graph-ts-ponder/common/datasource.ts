import './eager_offset'
import { Address } from './numbers'
import { Entity } from './collections'

/** Host interface for managing data sources */
export declare namespace dataSource {
  function create(name: string, params: Array<string>): void
  function createWithContext(
    name: string,
    params: Array<string>,
    context: DataSourceContext,
  ): void

  // Properties of the data source that fired the event.
  function address(): Address
  function network(): string
  function context(): DataSourceContext
}

/** Context for dynamic data sources */
export class DataSourceContext extends Entity {}

/**
 * Base class for data source templates. Allows to dynamically create
 * data sources from templates at runtime.
 */
export class DataSourceTemplate {
  /**
   * Dynamically creates a data source from the template with the
   * given name, using the parameter strings to configure the new
   * data source.
   */
  static create(name: string, params: Array<string>): void {
    dataSource.create(name, params)
  }

  static createWithContext(
    name: string,
    params: Array<string>,
    context: DataSourceContext,
  ): void {
    dataSource.createWithContext(name, params, context)
  }
}
