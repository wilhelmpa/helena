#!/bin/sh
set -eu

case "${PWD}" in
  /projects/itsaplan|/projects/itsaplan/*|/home/pw/services/itsaplan|/home/pw/services/itsaplan/*)
    exec /opt/bun/1.4.0/bun "$@"
    ;;
  *)
    exec /opt/bun/1.4.2/bun "$@"
    ;;
esac
