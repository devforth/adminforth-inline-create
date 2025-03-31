import { AdminForthPlugin } from "adminforth";
import type { IAdminForth, IHttpServer, AdminForthResourcePages, AdminForthResourceColumn, AdminForthDataTypes, AdminForthResource } from "adminforth";
import type { PluginOptions } from './types.js';

export default class InlineCreatePlugin extends AdminForthPlugin {
  options: PluginOptions;

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
  }

  async modifyResourceConfig(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    super.modifyResourceConfig(adminforth, resourceConfig);

    // Add custom component injection for inline create form
    if (!resourceConfig.options.pageInjections) {
      resourceConfig.options.pageInjections = {};
    }

    if (!resourceConfig.options.pageInjections.list) {
      resourceConfig.options.pageInjections.list = {};
    }

    // Set as array of component declarations
    resourceConfig.options.pageInjections.list.tableBodyStart = [{
      file: this.componentPath('InlineCreateForm.vue'),
      meta: {
        pluginInstanceId: this.pluginInstanceId
      }
    }];
  }

  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    // Check each column for potential configuration issues
    for (const column of resourceConfig.columns) {
      if (column.backendOnly) continue;

      const isRequiredForCreate = column.required?.create === true;
      const isVisibleInList = column.showIn?.list !== false;
      const hasFillOnCreate = column.fillOnCreate !== undefined;
      const isVisibleInCreate = column.showIn?.create !== false;

      if (isRequiredForCreate && !isVisibleInList && !hasFillOnCreate) {
        throw new Error(
          `Column "${column.name}" in resource "${resourceConfig.resourceId}" is required for create but not visible in list view. ` +
          'Either:\n' +
          '1) Set showIn.list: true, or\n' +
          '2) Set required.create: false and ensure a database default exists, or\n' +
          '3) Add fillOnCreate property and set showIn.create: false'
        );
      }

      if (hasFillOnCreate && isVisibleInCreate) {
        throw new Error(
          `Column "${column.name}" in resource "${resourceConfig.resourceId}" has fillOnCreate but is still visible in create form. ` +
          'When using fillOnCreate, set showIn.create: false'
        );
      }
    }
  }

  instanceUniqueRepresentation() {
    return 'inline-create';
  }

  setupEndpoints(server: IHttpServer) {
    server.endpoint({
      method: 'POST',
      path: `/plugin/${this.pluginInstanceId}/create`,
      handler: async ({ body, adminforth, adminUser }) => {
        const { record, resourceId } = body;
        
        const resource = this.adminforth.config.resources.find(r => r.resourceId === resourceId);
        
        // Create a new record object with only valid database columns
        const cleanRecord = {};
        
        for (const field of resource.columns) {
          
          if (record[field.name] !== undefined && record[field.name] !== null) {
            cleanRecord[field.name] = record[field.name];
          }
        }
        const result = await this.adminforth.createResourceRecord({
          resource,
          record: cleanRecord,
          adminUser
        });

        if (result.error) {
          return { error: result.error };
        }
        return { record: result.createdRecord };
      }
    });
  }
}