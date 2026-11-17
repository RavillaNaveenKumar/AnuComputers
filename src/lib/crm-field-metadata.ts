export type CrmFieldWriteMetadata = {
  apiName: string;
  origin: "SYSTEM" | "STANDARD" | "CUSTOM";
  readOnly: boolean;
  dataType: string;
};

export function immutableCrmFieldName(data: Record<string, unknown>, fields: CrmFieldWriteMetadata[]) {
  return fields.find((field) =>
    Object.hasOwn(data, field.apiName) &&
    (field.origin === "SYSTEM" || field.readOnly || field.dataType === "AUTO_NUMBER"))?.apiName;
}
