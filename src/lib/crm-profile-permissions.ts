export type ProfileObjectGrant = {
  canCreate: boolean;
  canRead: boolean;
  canEdit: boolean;
  canDelete: boolean;
  viewAll: boolean;
  modifyAll: boolean;
};

export function resolveObjectCapabilities(permission: ProfileObjectGrant | null) {
  return {
    canCreate: permission?.canCreate === true || permission?.modifyAll === true,
    canRead: permission?.canRead === true || permission?.viewAll === true || permission?.modifyAll === true,
    canEdit: permission?.canEdit === true || permission?.modifyAll === true,
    canDelete: permission?.canDelete === true || permission?.modifyAll === true,
  };
}

export function resolveEffectiveObjectCapabilities(
  profilePermission: ProfileObjectGrant | null,
  permissionSetGrants: ProfileObjectGrant[],
) {
  const grants = [profilePermission, ...permissionSetGrants].filter((grant): grant is ProfileObjectGrant => grant !== null);
  if (!grants.length) return resolveObjectCapabilities(null);
  return resolveObjectCapabilities({
    canCreate: grants.some(({ canCreate }) => canCreate),
    canRead: grants.some(({ canRead }) => canRead),
    canEdit: grants.some(({ canEdit }) => canEdit),
    canDelete: grants.some(({ canDelete }) => canDelete),
    viewAll: grants.some(({ viewAll }) => viewAll),
    modifyAll: grants.some(({ modifyAll }) => modifyAll),
  });
}

export function resolveFieldCapabilities(permission: { visible: boolean; editable: boolean } | null, readOnly = false) {
  return {
    canRead: permission?.visible === true,
    canEdit: permission?.visible === true && permission.editable && !readOnly,
  };
}

export function resolveEffectiveFieldCapabilities(
  profilePermission: { visible: boolean; editable: boolean } | null,
  permissionSetGrants: { canRead: boolean; canEdit: boolean }[],
  readOnly = false,
) {
  const canRead = profilePermission?.visible === true || permissionSetGrants.some(({ canRead, canEdit }) => canRead || canEdit);
  const canEdit = (profilePermission?.visible === true && profilePermission.editable) || permissionSetGrants.some(({ canEdit }) => canEdit);
  return { canRead, canEdit: canRead && canEdit && !readOnly };
}

export function isTabVisible(profileVisibility: string | null, permissionSetVisibilities: string[]) {
  if (profileVisibility === "HIDDEN") return false;
  return profileVisibility === "DEFAULT_ON" || permissionSetVisibilities.includes("DEFAULT_ON");
}
