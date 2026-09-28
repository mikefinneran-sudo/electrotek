import type { ClientConfig, ClientModule, ModuleRegistry } from "./types";

type ModuleValidationSource = ModuleRegistry | readonly ClientModule[];

function isModuleList(source: ModuleValidationSource): source is readonly ClientModule[] {
  return Array.isArray(source);
}

function modulesFromSource(source: ModuleValidationSource): ClientModule[] {
  return isModuleList(source) ? [...source] : source.list();
}

function validateAttributeKeys(
  keys: readonly string[] | undefined,
  field: string,
  errors: string[],
) {
  for (const key of keys ?? []) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      errors.push(`${field} attribute key "${key}" must be snake_case`);
    }
  }
}

// Registers a module into the given registry. The registry is required and
// instance-scoped on purpose — there is no hidden global, so separate
// createRegistry() calls never bleed into each other.
export function registerModule(module: ClientModule, registry: ModuleRegistry): void {
  registry.register(module);
}

export function createRegistry(extra: ClientModule[] = []): ModuleRegistry {
  const modules = new Map<string, ClientModule>();

  const registry: ModuleRegistry = {
    register(module: ClientModule) {
      modules.set(module.id, module);
    },
    get(id: string) {
      return modules.get(id);
    },
    list() {
      return [...modules.values()];
    },
    resolve(config: ClientConfig) {
      return config.modules
        .map((id) => modules.get(id))
        .filter((module): module is ClientModule => module !== undefined);
    },
  };

  for (const mod of extra) {
    registry.register(mod);
  }

  return registry;
}

export function validateClientConfig(
  config: ClientConfig,
  source?: ModuleValidationSource,
): string[] {
  const errors: string[] = [];

  if (!config.slug.trim()) errors.push("slug is required");
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.slug))
    errors.push(`slug "${config.slug}" must be lowercase alphanumeric with single hyphens`);
  if (!config.domain.trim()) errors.push("domain is required");
  if (!config.brand.name.trim()) errors.push("brand.name is required");
  if (typeof config.vertical === "string") {
    if (!config.vertical.trim()) errors.push("vertical must not be empty when provided");
  } else if (config.vertical) {
    if (!config.vertical.descriptor.trim()) {
      errors.push("vertical.descriptor is required when vertical is an object");
    }
    validateAttributeKeys(
      config.vertical.productAttributes,
      "vertical.productAttributes",
      errors,
    );
    validateAttributeKeys(
      config.vertical.inspectionAttributes,
      "vertical.inspectionAttributes",
      errors,
    );
  }
  if (config.modules.length === 0) errors.push("at least one module is required");

  if (config.data.adapter === "supabase" && !config.data.projectRef?.trim())
    errors.push('data.projectRef is required when adapter is "supabase"');
  if (config.data.adapter === "airtable" && !config.data.bases)
    errors.push('data.bases is required when adapter is "airtable"');

  if (config.ai) {
    if (!config.ai.model.trim()) errors.push("ai.model is required when ai is set");

    if (!config.ai.baseUrlEnvVar.trim()) {
      errors.push("ai.baseUrlEnvVar is required when ai is set");
    } else if (/^https?:\/\//i.test(config.ai.baseUrlEnvVar)) {
      // A literal endpoint here pins the deploy to one gateway at build time.
      errors.push("ai.baseUrlEnvVar must be an env var NAME, not a URL");
    }

    if (!config.ai.apiKeyEnvVar.trim()) {
      errors.push("ai.apiKeyEnvVar is required when ai is set");
    } else if (/^sk-/.test(config.ai.apiKeyEnvVar)) {
      // A real key here would be committed to the repo. Fail loudly.
      errors.push("ai.apiKeyEnvVar must be an env var NAME, not a key value");
    }
  }

  const seen = new Set();
  for (const moduleId of config.modules) {
    if (seen.has(moduleId)) errors.push(`duplicate module id: ${moduleId}`);
    seen.add(moduleId);
  }

  if (source) {
    const availableModules = new Map(
      modulesFromSource(source).map((module) => [module.id, module]),
    );
    const enabled = new Set(config.modules);

    for (const moduleId of config.modules) {
      const mod = availableModules.get(moduleId);

      if (!mod) {
        errors.push(`unknown module id: ${moduleId}`);
        continue;
      }

      if (mod.dataAdapters && !mod.dataAdapters.includes(config.data.adapter)) {
        errors.push(
          `module "${moduleId}" does not support data adapter "${config.data.adapter}"`,
        );
      }

      for (const dependency of mod.requires ?? []) {
        if (!enabled.has(dependency)) {
          errors.push(
            `module "${moduleId}" requires "${dependency}", which is not enabled`,
          );
        }
      }
    }
  }

  return errors;
}
