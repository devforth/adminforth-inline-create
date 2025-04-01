<template>
  <template v-if="isCreating">
    <td class="px-4 py-2"></td>
    <td v-for="column in allVisibleColumns" :key="column.name" class="px-2 md:px-3 lg:px-6 py-2">
      <div v-if="isEditableColumn(column)" class="flex gap-2">
        <ColumnValueInputWrapper
          ref="input"
          class="min-w-24"
          :source="'create'"
          :column="column"
          :currentValues="formData"
          :mode="'create'"
          :columnOptions="columnOptions"
          :unmasked="unmasked"
          :setCurrentValue="setCurrentValue"
          @update:unmasked="handleUnmasked"
        />
        <div v-if="column.required?.create" ><IconExclamationCircleSolid class="w-4 h-4"/></div>
      </div>
      <div v-else></div>
    </td>
    <td class="px-4 pt-4 flex gap-2 items-center">
      <button 
        @click="handleSave"
        class="text-green-600 hover:text-green-800 disabled:opacity-50"
        :disabled="saving || !isValid"
      >
        <IconCheckOutline v-if="!saving" class="w-5 h-5"/>
      </button>
      <button 
        @click="cancelCreate"
        class="text-red-600 hover:text-red-800"
      >
        <IconXOutline class="w-5 h-5"/>
      </button>
    </td>
  </template>
  <template v-else>
    <td :colspan="visibleColumns.length + 1" class="px-4 py-2">
      <button 
        @click="startCreate"
        class="w-full text-left text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <div class="flex items-center">
          <IconPlusOutline class="w-4 h-4 mr-2"/>
          {{ t('Add new record') }}
        </div>
      </button>
    </td>
  </template>
  </template>
  
  <script setup>
  import { ref, computed } from 'vue';
  import { useCoreStore } from '@/stores/core';
  import { callAdminForthApi } from '@/utils';
  import { useI18n } from 'vue-i18n';
  import ColumnValueInputWrapper from '@/components/ColumnValueInputWrapper.vue';
  import { IconCheckOutline, IconXOutline, IconPlusOutline, IconExclamationCircleSolid} from '@iconify-prerendered/vue-flowbite';
  import { computedAsync } from '@vueuse/core';
  import { useRouter } from 'vue-router';
  
  const props = defineProps(['meta']);
  const emit = defineEmits(['update:records']);
  const { t } = useI18n();
  const router = useRouter();
  
  const coreStore = useCoreStore();
  const isCreating = ref(false);
  const saving = ref(false);
  const formData = ref({});
  const unmasked = ref({});
  const invalidFields = ref({});
  const emptyFields = ref({});

  const visibleColumns = computed(() => 
    coreStore.resource.columns.filter(c => !c.backendOnly && c.showIn?.create !== false && !c.primaryKey)
  );
  function handleUnmasked(columnName) {
    unmasked.value[columnName] = !unmasked.value[columnName];
  }

  const allVisibleColumns = computed(() => {
    const columnsMap = new Map();
    
    coreStore.resource.columns.filter(c => c.showIn?.list).forEach(column => {
      columnsMap.set(column.label, column);
    });
    
    visibleColumns.value.forEach(column => {
      columnsMap.set(column.label, column);
    });
    
    return Array.from(columnsMap.values());
  });

  // Function to check if a column should be editable
  function isEditableColumn(column) {
    return !column.backendOnly && column.showIn?.create !== false && !column.primaryKey;
  }
  
  const columnOptions = computedAsync(async () => { 
    return (await Promise.all(
      Object.values(coreStore.resource.columns).map(async (column) => {
        if (column.foreignResource) {
          const list = await callAdminForthApi({
            method: 'POST',
            path: `/get_resource_foreign_data`,
            body: {
              resourceId: coreStore.resource.resourceId,
              column: column.name,
              limit: 1000,
              offset: 0,
            },
          });
  
          if (!column.required?.create) list.items.push({ value: null, label: column.foreignResource.unsetLabel });
  
          return { [column.name]: list.items };
        }
      })
    )).reduce((acc, val) => Object.assign(acc, val), {})
  }, {});
  
  const isValid = computed(() => {
    return !Object.values(invalidFields.value).some(invalid => invalid);
  });
  
  function initializeFormData() {
    const newFormData = {};
    visibleColumns.value.forEach(column => {
      if (column.isArray?.enabled) {
        newFormData[column.name] = []; // Initialize as empty array
      } else if (column.type === 'json') {
        newFormData[column.name] = null;
      } else if (column.suggestOnCreate !== undefined) {
        newFormData[column.name] = column.suggestOnCreate;
      } else {
        newFormData[column.name] = null;
      }
    });
    formData.value = newFormData;
    invalidFields.value = {};
    emptyFields.value = {};
  }
  
  function startCreate() {
    isCreating.value = true;
    initializeFormData();
  }
  
  function cancelCreate() {
    isCreating.value = false;
    formData.value = {};
    invalidFields.value = {};
    emptyFields.value = {};
  }
  
  function setCurrentValue(field, value, arrayIndex = undefined) {
    if (arrayIndex !== undefined) {
      // Handle array updates
      if (!Array.isArray(formData.value[field])) {
        formData.value[field] = [];
      }
      
      const column = coreStore.resource.columns.find(c => c.name === field);
      const newArray = [...formData.value[field]];
      
      if (arrayIndex >= newArray.length) {
        // When adding a new item, always add null
        newArray.push(null);
      } else {
        // For existing items, handle type conversion
        if (column?.isArray?.itemType && ['integer', 'float', 'decimal'].includes(column.isArray.itemType)) {
          newArray[arrayIndex] = value !== null && value !== '' ? +value : null;
        } else {
          newArray[arrayIndex] = value;
        }
      }
      
      // Assign the new array
      formData.value[field] = newArray;
    } else {
      // Handle non-array updates
      formData.value[field] = value;
    }
  }
  
  async function handleSave() {
    if (!isValid.value) return;
    
    saving.value = true;
    try {
      const response = await callAdminForthApi({
        method: 'POST',
        path: `/plugin/${props.meta.pluginInstanceId}/create`,
        body: {
          resourceId: coreStore.resource.resourceId,
          record: formData.value
        }
      });
  
      if (response.error) {
        adminforth.alert({
          message: response.error,
          variant: 'error'
        });
        return;
      }
      cancelCreate();
      
      adminforth.alert({
        message: t('Record created successfully!'),
        variant: 'success'
      });
      await adminforth.list.refresh();
    } finally {
      saving.value = false;
    }
  }
  </script>