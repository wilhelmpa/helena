# Kiosk on Kingston's own screens

Install or update everything with `sudo deployment/volition-stack/native/kiosk/install.sh`
(needs the Debian package `wlr-randr`).

When Kingston boots natively (not as a container), tty1 signs in the user `plan-kiosk`
automatically and shows Helena full screen: cage runs Chromium in kiosk mode, on one screen
or extended across two. The session script sets every output to scale 2 in the compositor
(`wlr-randr`), so Chromium renders natively at the screens' resolution under Wayland: text
and images stay crisp. Ctrl +/- zooms the page on top; `VOLITION_KIOSK_SCALE` changes the
scale.

| File | Installed as |
| --- | --- |
| `plan-kiosk.sh` | `/usr/local/libexec/volition-plan-kiosk` (root, 0755) |
| `kiosk-session.sh` | `/usr/local/libexec/volition-plan-kiosk-session`, runs inside cage |
| `kiosk-hotplug.sh` + `90-volition-kiosk.rules` | `/usr/local/libexec/volition-plan-kiosk-hotplug`, `/etc/udev/rules.d/`: restarts the kiosk when the number of screens changes |
| `getty-autologin.conf` | `/etc/systemd/system/getty@tty1.service.d/plan-kiosk.conf` |
| `bash_profile` | `/var/lib/plan-kiosk/.bash_profile` (owner `plan-kiosk`) |

The script counts the connected outputs and opens
`http://kingston-server.local/?kioskDisplay=single` or `?kioskDisplay=dual`. With two
screens the web app (`apps/web/src/utils/kioskDisplay.ts`) pins the tool panel to the
second one: half the window, always open, without pin, fullscreen or close buttons.
Inside the container (`systemd-detect-virt --container`) none of this starts. The
kiosk's Chromium profile is `/var/lib/plan-kiosk/chromium`; it signs in over the LAN like
any other device on it.
