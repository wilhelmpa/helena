# Kingston LAN mDNS publication

`avahi_publisher.py` publishes `kingston-server.local` as the Ubuntu host's
private WLAN address only on `wlp195s0`. The same entry group advertises Plan on
HTTP port 80 and the user-scoped SSH relay on port 2222. It refuses a missing or
renumbered interface, a non-private address, an unavailable Avahi daemon, and an
mDNS name collision.

Install it for the operator account after the HTTP reverse proxy and SSH relay
have both been validated:

```sh
install -Dm 0755 avahi_publisher.py ~/.local/bin/volition-lan-avahi-publisher
install -Dm 0644 volition-lan-avahi-publisher.service \
  ~/.config/systemd/user/volition-lan-avahi-publisher.service
~/.local/bin/volition-lan-avahi-publisher \
  --interface wlp195s0 --address 192.168.2.220 \
  --hostname kingston-server.local --http-port 80 --ssh-port 2222 --check
systemctl --user daemon-reload
systemctl --user enable --now volition-lan-avahi-publisher.service
```

The user must have lingering enabled for publication after logout. Validate from
a second LAN device: resolve `kingston-server.local` to `192.168.2.220`, open
`http://kingston-server.local/`, and connect with
`ssh -p 2222 wilhelmpa@kingston-server.local`. A local resolver result alone is
not LAN acceptance.
