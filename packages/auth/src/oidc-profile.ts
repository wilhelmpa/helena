// OIDC's profile scope does not require a display name. Cloudflare Access can
// return only sub + email. Use those claims for a label without elevating the
// provider's email verification or changing its stable account identifier.
export function oidcProfileLabel(profile: Record<string, unknown>): { name?: string } {
  for (const key of ['name', 'preferred_username', 'email']) {
    const value = profile[key];
    if (typeof value === 'string' && value.trim()) return { name: value.trim() };
  }
  return {};
}
