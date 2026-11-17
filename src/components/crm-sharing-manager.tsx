"use client";

import { useEffect, useState } from "react";

type SharingObject = {
  id: string;
  pluralLabel: string;
  apiName: string;
  fields: { id: string; label: string; apiName: string; dataType: string; active: boolean }[];
};

type SharingConfigResponse = {
  config: {
    defaultAccess: "PRIVATE" | "PUBLIC_READ_ONLY" | "PUBLIC_READ_WRITE" | "CONTROLLED_BY_PARENT";
    grantAccessUsingHierarchy: boolean;
    parentRelationshipId: string | null;
  } | null;
  parentRelationships: {
    id: string;
    label: string;
    field: { label: string; apiName: string } | null;
    targetObject: { pluralLabel?: string; name: string };
  }[];
  hierarchyRoles: { id: string; name: string }[];
  users: { id: string; name: string; email: string; role: string }[];
};

type SharingRule = {
  id: string;
  name: string;
  ruleType: "OWNER" | "CRITERIA";
  access: "READ" | "EDIT";
  sourceHierarchyRole: { id: string; name: string } | null;
  targetHierarchyRole: { id: string; name: string } | null;
  targetUser: { id: string; name: string; email: string } | null;
  sourceIncludesSubordinates: boolean;
  targetIncludesSubordinates: boolean;
  criteria: { operator: "AND" | "OR"; conditions: { field: string; operator: string; value?: unknown }[] } | null;
};

type Props = { objects: SharingObject[] };
type DefaultAccess = NonNullable<SharingConfigResponse["config"]>["defaultAccess"];

async function errorMessage(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  return `Request failed (${response.status}).`;
}

export function CrmSharingManager({ objects }: Props) {
  const [objectId, setObjectId] = useState(objects[0]?.id ?? "");
  const [configData, setConfigData] = useState<SharingConfigResponse | null>(null);
  const [rules, setRules] = useState<SharingRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [criteriaField, setCriteriaField] = useState("");

  const selected = objects.find((object) => object.id === objectId);
  const selectedCriteriaField = selected?.fields.find((field) => field.apiName === criteriaField)
    ?? selected?.fields.find((field) => field.active);

  useEffect(() => {
    if (!objectId && objects[0]) setObjectId(objects[0].id);
  }, [objectId, objects]);

  async function load() {
    if (!objectId) return;
    setLoading(true);
    setError("");
    try {
      const [configResponse, rulesResponse] = await Promise.all([
        fetch(`/api/crm-setup/sharing/${objectId}`),
        fetch(`/api/crm-setup/sharing/${objectId}/rules`),
      ]);
      if (!configResponse.ok) throw new Error(await errorMessage(configResponse));
      if (!rulesResponse.ok) throw new Error(await errorMessage(rulesResponse));
      setConfigData(await configResponse.json() as SharingConfigResponse);
      setRules(await rulesResponse.json() as SharingRule[]);
      setCriteriaField("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load sharing settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  // load follows the selected object; its state is intentionally refreshed on id changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId]);

  async function send(url: string, method: string, body: unknown) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setNotice("Sharing settings saved.");
      await load();
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save sharing settings.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const defaultAccess = String(form.get("defaultAccess")) as DefaultAccess;
    const parentRelationshipId = defaultAccess === "CONTROLLED_BY_PARENT"
      ? String(form.get("parentRelationshipId") || "")
      : null;
    if (defaultAccess === "CONTROLLED_BY_PARENT" && !parentRelationshipId) {
      setError("Choose a parent lookup relationship.");
      return;
    }
    await send(`/api/crm-setup/sharing/${objectId}`, "PUT", {
      defaultAccess,
      grantAccessUsingHierarchy: form.get("grantAccessUsingHierarchy") === "on",
      parentRelationshipId,
    });
  }

  async function createRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !configData) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ruleType = String(form.get("ruleType"));
    const fieldName = String(form.get("field") || "");
    const operator = String(form.get("operator"));
    let criteria: SharingRule["criteria"] = null;
    if (ruleType === "CRITERIA") {
      const field = selected.fields.find((item) => item.apiName === fieldName);
      if (!field) {
        setError("Choose an active field for the criteria rule.");
        return;
      }
      let value: unknown;
      if (operator !== "IS_NULL") {
        const rawValue = String(form.get("value") ?? "");
        if (field.dataType === "NUMBER" || field.dataType === "CURRENCY") {
          value = Number(rawValue);
          if (!Number.isFinite(value)) {
            setError("Enter a valid number for this field.");
            return;
          }
        } else if (field.dataType === "CHECKBOX") {
          value = rawValue === "true";
        } else {
          value = rawValue;
        }
      }
      criteria = {
        operator: "AND",
        conditions: [{ field: fieldName, operator, ...(value !== undefined ? { value } : {}) }],
      };
    }
    const target = String(form.get("target") || "");
    const [targetType, targetId] = target.split(":", 2);
    if (!targetId || (targetType !== "USER" && targetType !== "ROLE")) {
      setError("Choose a target user or hierarchy role.");
      return;
    }
    const sourceHierarchyRoleId = String(form.get("sourceHierarchyRoleId") || "");
    const saved = await send(`/api/crm-setup/sharing/${objectId}/rules`, "POST", {
      name: form.get("name"),
      ruleType,
      sourceHierarchyRoleId: ruleType === "OWNER" ? sourceHierarchyRoleId : null,
      sourceIncludesSubordinates: ruleType === "OWNER" && form.get("sourceIncludesSubordinates") === "on",
      criteria,
      targetUserId: targetType === "USER" ? targetId : null,
      targetHierarchyRoleId: targetType === "ROLE" ? targetId : null,
      targetIncludesSubordinates: targetType === "ROLE" && form.get("targetIncludesSubordinates") === "on",
      access: form.get("access"),
    });
    if (saved) formElement.reset();
  }

  async function deleteRule(rule: SharingRule) {
    if (!window.confirm(`Delete the sharing rule "${rule.name}"?`)) return;
    await send(`/api/crm-setup/sharing/${objectId}/rules`, "DELETE", { id: rule.id });
  }

  if (!objects.length) return <p className="panel-empty-copy">No CRM objects are available for sharing configuration.</p>;

  return <section className="crm-manager">
    <div className="crm-manager-filters">
      <label><span>Object</span><select value={objectId} onChange={(event) => setObjectId(event.target.value)}>{objects.map((object) => <option key={object.id} value={object.id}>{object.pluralLabel} · {object.apiName}</option>)}</select></label>
    </div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    {notice && <p className="crm-setup-success" role="status">{notice}</p>}
    {loading || !configData || !selected ? <div className="crm-setup-loading">Loading record-sharing settings…</div> : <>
      <section className="panel crm-manager-details">
        <div className="crm-panel-heading"><div><h2>Organization-wide defaults</h2><p>Set the baseline record access before additive sharing grants are applied.</p></div></div>
        <form className="form-grid crm-setup-form" onSubmit={(event) => void saveConfig(event)}>
          <label className="field"><span>Default record access</span><select name="defaultAccess" defaultValue={configData.config?.defaultAccess ?? "PRIVATE"}>
            <option value="PRIVATE">Private</option>
            <option value="PUBLIC_READ_ONLY">Public read only</option>
            <option value="PUBLIC_READ_WRITE">Public read / write</option>
            <option value="CONTROLLED_BY_PARENT">Controlled by parent</option>
          </select></label>
          {configData.config?.defaultAccess === "CONTROLLED_BY_PARENT" || configData.parentRelationships.length > 0
            ? <label className="field"><span>Parent lookup</span><select name="parentRelationshipId" defaultValue={configData.config?.parentRelationshipId ?? ""}>
              <option value="">Select a relationship</option>
              {configData.parentRelationships.map((relationship) => <option key={relationship.id} value={relationship.id}>
                {relationship.field?.label ?? relationship.label} → {relationship.targetObject.pluralLabel ?? relationship.targetObject.name}
              </option>)}
            </select></label>
            : null}
          <label className="crm-required-toggle"><input type="checkbox" name="grantAccessUsingHierarchy" defaultChecked={configData.config?.grantAccessUsingHierarchy ?? false} /> Grant access to managers in the role hierarchy</label>
          <p className="crm-dialog-note field-full">Applies to registry-backed records with an owner. Parent control is available only through a lookup to another registry-backed object.</p>
          <div className="form-actions field-full"><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save defaults"}</button></div>
        </form>
      </section>

      <section className="panel crm-manager-details section-spacer">
        <div className="crm-panel-heading"><div><h2>Sharing rules</h2><p>Grant record access from selected owners or matching field criteria.</p></div></div>
        <form className="form-grid crm-setup-form" onSubmit={(event) => void createRule(event)}>
          <label className="field"><span>Rule name</span><input name="name" required maxLength={80} /></label>
          <label className="field"><span>Rule type</span><select name="ruleType"><option value="OWNER">Owner-based</option><option value="CRITERIA">Criteria-based</option></select></label>
          <label className="field"><span>Owner role</span><select name="sourceHierarchyRoleId" defaultValue={configData.hierarchyRoles[0]?.id ?? ""}>
            {configData.hierarchyRoles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
          </select></label>
          <label className="crm-required-toggle"><input type="checkbox" name="sourceIncludesSubordinates" /> Include owner-role subordinates</label>
          <label className="field"><span>Criteria field</span><select name="field" value={selectedCriteriaField?.apiName ?? ""} onChange={(event) => setCriteriaField(event.target.value)}>
            {selected.fields.filter((field) => field.active).map((field) => <option value={field.apiName} key={field.id}>{field.label}</option>)}
          </select></label>
          <label className="field"><span>Criteria operator</span><select name="operator">
            <option value="EQUALS">Equals</option><option value="NOT_EQUALS">Does not equal</option>
            {selectedCriteriaField && ["TEXT", "TEXT_AREA", "EMAIL", "PHONE", "URL", "PICKLIST"].includes(selectedCriteriaField.dataType) && <option value="CONTAINS">Contains</option>}
            <option value="IS_NULL">Is empty</option>
          </select></label>
          <label className="field"><span>Criteria value</span>{selectedCriteriaField?.dataType === "CHECKBOX"
            ? <select name="value"><option value="true">True</option><option value="false">False</option></select>
            : <input name="value" type={["NUMBER", "CURRENCY"].includes(selectedCriteriaField?.dataType ?? "") ? "number" : "text"} step="any" />}</label>
          <label className="field"><span>Share with</span><select name="target" required>
            <optgroup label="Hierarchy roles">{configData.hierarchyRoles.map((role) => <option value={`ROLE:${role.id}`} key={`role-${role.id}`}>{role.name}</option>)}</optgroup>
            <optgroup label="Users">{configData.users.map((user) => <option value={`USER:${user.id}`} key={`user-${user.id}`}>{user.name} · {user.email}</option>)}</optgroup>
          </select></label>
          <label className="crm-required-toggle"><input type="checkbox" name="targetIncludesSubordinates" /> Include target-role subordinates</label>
          <label className="field"><span>Access level</span><select name="access"><option value="READ">Read</option><option value="EDIT">Read / edit</option></select></label>
          <div className="form-actions field-full"><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Create sharing rule"}</button></div>
        </form>
        <div className="crm-manager-fields">
          {rules.map((rule) => <div className="crm-manager-field" key={rule.id}>
            <span className="crm-field-main"><strong>{rule.name}</strong><small>{rule.ruleType === "OWNER" ? `Owner: ${rule.sourceHierarchyRole?.name ?? "role"}` : "Criteria match"} · {rule.targetUser?.name ?? rule.targetHierarchyRole?.name} · {rule.access}</small></span>
            <button type="button" className="button button-quiet" onClick={() => void deleteRule(rule)} disabled={saving}>Delete</button>
          </div>)}
          {!rules.length && <p className="panel-empty-copy">No sharing rules are configured for this object.</p>}
        </div>
      </section>
    </>}
  </section>;
}
