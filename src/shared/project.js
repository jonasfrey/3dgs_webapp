export const stages = [
  ["inspect", "Inspect video"],
  ["frames", "Extract frames"],
  ["reconstruction", "Reconstruct cameras"],
  ["training", "Train Gaussian splat"],
  ["export", "Export scene"],
];
export function validName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new Error("Enter a project name between 1 and 120 characters.");
  }
  return value.trim();
}
export function canProcess(project) {
  return !!project.input &&
    !["processing", "uploading"].includes(project.status);
}
export function validId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    .test(id);
}
export function bytes(value) {
  return value < 1048576
    ? `${(value / 1024).toFixed(0)} KB`
    : value < 1073741824
    ? `${(value / 1048576).toFixed(1)} MB`
    : `${(value / 1073741824).toFixed(2)} GB`;
}
