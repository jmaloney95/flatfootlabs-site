#!/usr/bin/env bash
# Opens the sealed launch bundle onto a docs/ folder: decrypts it with the passphrase in $LAUNCH_KEY,
# checks every file against the bundle's hash list, then copies the files in. Used by the launch
# workflow, and by hand to rehearse a launch on a copy of the site.
#
#   LAUNCH_KEY=... bash open_bundle.sh <bundle.tar.gz.gpg> <docs dir>
set -euo pipefail

bundle=$1
docs=$2
: "${LAUNCH_KEY:?LAUNCH_KEY is not set}"
[ -f "$docs/index.html" ] || { echo "no site in $docs" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

printf '%s' "$LAUNCH_KEY" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt --output "$work/bundle.tar.gz" "$bundle"
tar -xzf "$work/bundle.tar.gz" -C "$work"
( cd "$work" && sha256sum --quiet --check MANIFEST.sha256 )

# The after pages were made from these before pages. If the live ones have changed since, the
# after pages miss those edits: still launch, but say so loudly.
while read -r want path; do
  have=$(sha256sum "$docs/${path#docs/}" 2>/dev/null | cut -d' ' -f1 || true)
  if [ "$have" != "$want" ]; then
    echo "::warning::${path} changed after the bundle was made; the launched page won't have those edits"
  fi
done < "$work/BUILT_FROM.sha256"

cp -R "$work/docs/." "$docs/"
grep -q 'Out now' "$docs/index.html" || { echo "the opened home page isn't the launched one" >&2; exit 1; }
echo "opened $(wc -l < "$work/MANIFEST.sha256") files onto $docs"
