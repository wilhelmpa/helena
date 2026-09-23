// Syncthing shows a device without a name by the first group of its ID.
export function deviceName(device: { name: string; deviceId: string }): string {
  return device.name.trim() || device.deviceId.split('-')[0]!;
}
