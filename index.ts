import { ActionCheckSource, AdminForthPlugin, interpretResource } from "adminforth";
import type { IAdminForth, IHttpServer, AdminForthResourcePages, AdminForthResourceColumn, AdminForthDataTypes, AdminForthResource } from "adminforth";
import type { PluginOptions } from './types.js';
import { z } from "zod";

const createBodySchema = z.object({
  resourceId: z.string(),
  record: z.record(z.string(), z.unknown()).nullish(),
}).strict();

export default class InlineCreatePlugin extends AdminForthPlugin {
  options: PluginOptions;

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
  }

  private parseBody<T>(
    schema: z.ZodType<T>,
    body: unknown,
    response: { setStatus: (code: number, message: string) => void },
  ): T | null {
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
      response.setStatus(422, parsed.error.message);
      return null;
    }
    return parsed.data;
  }

  async modifyResourceConfig(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    super.modifyResourceConfig(adminforth, resourceConfig);

    if (!resourceConfig.options.pageInjections) {
      resourceConfig.options.pageInjections = {};
    }

    if (!resourceConfig.options.pageInjections.list) {
      resourceConfig.options.pageInjections.list = {};
    }

    if (this.resourceConfig.options.allowedActions.create === false) {
      throw new Error(`InlineCreatePlugin cannot be used on resource "${resourceConfig.resourceId}" because create action is disabled`);
    }

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
      handler: async ({ body, adminUser, response }) => {
        const data = this.parseBody(createBodySchema, body, response);
        if (!data) return;
        const { record, resourceId } = data;

        if (!record) {
          return { error: 'No record provided' };
        }

        if ( this.resourceConfig.resourceId !== resourceId) {
          return { error: 'Resource ID mismatch' };
        }

        const resource = this.adminforth.config.resources.find(r => r.resourceId === resourceId);

        const { allowedActions } = await interpretResource(adminUser, resource, {}, ActionCheckSource.DisplayButtons, this.adminforth);
        if (!allowedActions.create) {
          return { error: 'User does not have permission to create records for this resource' };
        }

        for (const column of resource.columns) {
          if (column.backendOnly) {
            if (record[column.name] !== undefined) {
              return { error: `Column "${column.name}" is backend-only and cannot be set by the user` };
            }
          };
        }

        const cleanRecord = resource.columns.reduce((acc, field) => {
          if (record[field.name] !== undefined && record[field.name] !== null) {
            acc[field.name] = record[field.name];
          }
          return acc;
        }, {});
        
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