export type CustomFieldType =
  | "TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "CURRENCY"
  | "DATE"
  | "CHECKBOX"
  | "PICKLIST"
  | "LOOKUP";

export type RelationshipKind = "LOOKUP" | "MASTER_DETAIL" | "ONE_TO_ONE";

export type CustomField = {
  id: string;
  label: string;
  apiName: string;
  type: CustomFieldType;
  required: boolean;
  options: string[];
  relatedObjectId?: string;
  relationshipKind?: RelationshipKind;
};

export type CustomRecord = {
  id: string;
  values: Record<string, string | number | boolean | null>;
  createdAt: string;
};

export type CustomObject = {
  id: string;
  label: string;
  pluralLabel: string;
  apiName: string;
  description: string;
  fields: CustomField[];
  layoutFieldIds: string[];
  records: CustomRecord[];
  createdAt: string;
};

export function makeApiName(label: string) {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isValidApiName(apiName: string) {
  return /^[a-z][a-z0-9_]*$/.test(apiName);
}

export function validateCustomRecord(fields: CustomField[], values: Record<string, unknown>) {
  for (const field of fields) {
    const value = values[field.id];
    if ((field.required || (field.type === "LOOKUP" && field.relationshipKind === "MASTER_DETAIL")) &&
        (value === undefined || value === null || value === "")) {
      return `${field.label} is required.`;
    }
    if (value === undefined || value === null || value === "") continue;
    if (field.type === "NUMBER" || field.type === "CURRENCY") {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${field.label} must be a valid number.`;
    }
    if (field.type === "PICKLIST" && (typeof value !== "string" || !field.options.includes(value))) {
      return `Choose a valid option for ${field.label}.`;
    }
    if (field.type === "LOOKUP" && typeof value !== "string") {
      return `Choose a related record for ${field.label}.`;
    }
  }
  return null;
}
