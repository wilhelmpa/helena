// A sender display name is untrusted. Match the actual sender address's domain only.
export function isTkSender(address: string): boolean {
  return /^[^@\s]+@(?:[a-z0-9-]+\.)*tk\.de$/i.test(address.trim());
}
