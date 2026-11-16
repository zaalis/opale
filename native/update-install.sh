#!/bin/bash
set -euo pipefail
archive=$1; shell_pid=$2; server_pid=$3; target=$4; expected=$5; kind=$6
[[ "$target" = /* && "$target" != / && "$expected" =~ ^[a-f0-9]{64}$ ]] || exit 2
echo "5 Fermeture d'Opale"
for ((i=0;i<450;i++)); do
  waiting=0
  for pid in "$shell_pid" "$server_pid"; do [[ "$pid" =~ ^[0-9]+$ ]] || exit 2; if ((pid>0)) && kill -0 "$pid" 2>/dev/null; then waiting=1; fi; done
  ((waiting==0)) && break
  sleep .1
done
((waiting==0)) || { echo 'Opale ne s’est pas fermé.' >&2; exit 3; }
actual=$(sha256sum -- "$archive"); [[ "${actual%% *}" = "$expected" ]] || exit 4
echo '20 Vérification terminée'
if [[ "$kind" = deb ]]; then
  pkexec /usr/bin/apt-get install --yes "$archive"
else
  stage=$(mktemp -d -t opale-update-XXXXXXXX)
  trap 'rm -rf -- "$stage"' EXIT
  tar -xzf "$archive" --no-same-owner --strip-components=1 -C "$stage"
  files=(Opale opale-server opale-pickfolder opale-updater opale-update-install opale.png)
  for name in "${files[@]}"; do [[ -f "$stage/$name" && ! -L "$stage/$name" ]] || exit 5; done
  echo '45 Préparation des fichiers'
  for name in "${files[@]}"; do install -m 755 "$stage/$name" "$target/$name.update-new"; done
  committed=()
  rollback() {
    for name in "${committed[@]}"; do if [[ -f "$target/$name.update-old" ]]; then mv -Tf -- "$target/$name.update-old" "$target/$name"; else rm -f -- "$target/$name"; fi; done
  }
  for name in "${files[@]}"; do
    if [[ -e "$target/$name" ]]; then mv -Tf -- "$target/$name" "$target/$name.update-old" || { rollback; exit 6; }; fi
    committed+=("$name")
    mv -T -- "$target/$name.update-new" "$target/$name" || { rollback; exit 6; }
  done
  for name in "${files[@]}"; do rm -f -- "$target/$name.update-old"; done
fi
echo '100 Redémarrage en cours'
