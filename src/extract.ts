import type { Field, RawTool } from "./types.ts";

const COLLECTION_KEYS = [
  "issues",
  "pull_requests",
  "items",
  "data",
  "results",
  "repositories",
];

function defNameFromRef(ref: unknown): string | undefined {
  if (typeof ref !== "string") return undefined;
  const match = /^#\/\$defs\/(.+)$/.exec(ref);
  return match?.[1];
}

function isIdentifierOwnField(name: string): boolean {
  return (
    /^(id|number|sha|slug|node_id)$/i.test(name) ||
    /(_id|_number|_sha|_slug)$/i.test(name) ||
    /(Id|Number|Sha)$/.test(name)
  );
}

function isArrayOfObjects(prop: any): boolean {
  if (!prop || typeof prop !== "object") return false;
  if (prop.type === "array") {
    const items = prop.items;
    return !!(items && (items.$ref || items.type === "object" || items.properties));
  }
  return false;
}

function isListWrapper(schema: any, defName: string | undefined): boolean {
  if (!schema || typeof schema !== "object") return false;
  if (defName && /^(List|Search|Find).*Response$/i.test(defName)) return true;
  const props = schema.properties ?? {};
  const names = Object.keys(props);
  const hasIdent = names.some(isIdentifierOwnField);
  const arrayObjProps = names.filter((n) => isArrayOfObjects(props[n]));
  return !hasIdent && arrayObjProps.length === 1;
}

function isNestedObjectProp(prop: any): boolean {
  if (!prop || typeof prop !== "object") return false;
  if (prop.$ref) return true;
  if (isArrayOfObjects(prop)) return true;
  if (prop.type === "object" && prop.properties) return true;
  return false;
}

function collectFields(
  schema: any,
  defs: Record<string, any>,
  parentDefName: string | undefined,
  visited: Set<string>,
): Field[] {
  if (!schema || typeof schema !== "object") return [];

  if (schema.$ref) {
    const name = defNameFromRef(schema.$ref);
    if (!name || visited.has(name)) return [];
    visited.add(name);
    return collectFields(defs[name], defs, name, visited);
  }

  const branches = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(branches)) {
    const merged: Field[] = [];
    const seen = new Set<string>();
    for (const branch of branches) {
      for (const field of collectFields(branch, defs, parentDefName, new Set(visited))) {
        if (!seen.has(field.name)) {
          seen.add(field.name);
          merged.push(field);
        }
      }
    }
    return merged;
  }

  if (schema.items) {
    return collectFields(schema.items, defs, parentDefName, visited);
  }

  const props = schema.properties ?? {};
  if (isListWrapper(schema, parentDefName)) {
    for (const key of COLLECTION_KEYS) {
      if (props[key]) {
        return collectFields(props[key], defs, parentDefName, visited);
      }
    }
    for (const prop of Object.values(props)) {
      if (isArrayOfObjects(prop)) {
        return collectFields(prop, defs, parentDefName, visited);
      }
    }
  }

  const fields: Field[] = [];
  for (const [name, prop] of Object.entries(props)) {
    if (isNestedObjectProp(prop)) continue;
    const description = String((prop as any)?.description ?? (prop as any)?.title ?? "");
    fields.push({ name, description, parentDefName });
  }
  return fields;
}

export function extractPrimaryOutputs(tool: RawTool): Field[] {
  const output = tool.outputParameters ?? {};
  const defs = output.$defs ?? {};
  const data = output.properties?.data ?? output;
  return collectFields(data, defs, undefined, new Set());
}

export function extractInputs(tool: RawTool): { required: Field[]; all: Field[] } {
  const schema = tool.inputParameters ?? {};
  const props = schema.properties ?? {};
  const requiredNames = new Set<string>(schema.required ?? []);
  const all: Field[] = Object.entries(props).map(([name, prop]) => ({
    name,
    description: String((prop as any)?.description ?? (prop as any)?.title ?? ""),
  }));
  return { required: all.filter((f) => requiredNames.has(f.name)), all };
}
