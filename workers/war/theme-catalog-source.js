import sourceCatalog from '../../themes/catalog.json' with { type:'json' };

export const themeCatalogText = JSON.stringify(sourceCatalog);

export async function themeCatalogObjectKey() {
  const bytes = new TextEncoder().encode(themeCatalogText);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `metadata/themes/catalog.${hash}.json`;
}
