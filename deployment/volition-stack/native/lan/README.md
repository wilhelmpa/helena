# Native LAN SSH relay

This user service exposes the existing SSH daemon in the native Debian nspawn machine at
`192.168.122.58:22` on the m5 LAN address `192.168.2.220:2222`. It binds only that IPv4
address and accepts clients only from `192.168.2.0/24`. It does not manage SSH users,
host keys or authorized keys.

Install it for the current m5 user:

```sh
install -Dm0755 ssh_tcp_relay.py ~/.local/bin/volition-lan-ssh-relay
install -Dm0644 volition-lan-ssh-relay.service ~/.config/systemd/user/volition-lan-ssh-relay.service
systemctl --user daemon-reload
systemctl --user enable --now volition-lan-ssh-relay.service
```

Connect from the LAN with the existing Debian identity and host-key alias:

```sh
ssh -p 2222 -o HostKeyAlias=kingston-server.local wilhelmpa@192.168.2.220
```

Operational commands:

```sh
systemctl --user status volition-lan-ssh-relay.service
journalctl --user -u volition-lan-ssh-relay.service
systemctl --user restart volition-lan-ssh-relay.service
systemctl --user disable --now volition-lan-ssh-relay.service
```

The service starts at boot only while systemd lingering is enabled for the m5 user. It
depends on the m5 LAN address and the nspawn address remaining unchanged. Existing
connections have a 15-minute idle timeout and an eight-hour lifetime; at most 32 are
accepted concurrently. The relay provides no SSH authentication itself and must not be
used as a public-interface listener.

## Syncthing relay

`volition-lan-syncthing-relay.service` runs the same relay for Syncthing: it forwards
`192.168.2.220:22000` to `192.168.122.58:22000`, so devices on the home network sync
with Kingston directly instead of through the public Syncthing relays. Syncthing's local
discovery does not cross the private virtual network, so each device lists Kingston with
the addresses `tcp://192.168.2.220:22000, dynamic`. Plan shows this address in its
device guide once `SYNCTHING_LAN_ADDRESS=tcp://192.168.2.220:22000` is in
`/etc/volition/plan.env`.

```sh
install -Dm0644 volition-lan-syncthing-relay.service ~/.config/systemd/user/volition-lan-syncthing-relay.service
systemctl --user daemon-reload
systemctl --user enable --now volition-lan-syncthing-relay.service
```

A connection lasts at most seven days; Syncthing then connects again.
