#!/bin/sh
set -eu

url=${ONESPEED_SUPABASE_URL:-}
anon_key=${ONESPEED_SUPABASE_ANON_KEY:-}

if [ -z "$url" ] && [ -z "$anon_key" ]; then
  echo "OneSpeed: Supabase environment variables are not set; running in demo mode."
  exit 0
fi

if [ -z "$url" ] || [ -z "$anon_key" ]; then
  echo "OneSpeed: set both ONESPEED_SUPABASE_URL and ONESPEED_SUPABASE_ANON_KEY." >&2
  exit 1
fi

case "$url" in
  https://?*) ;;
  *)
    echo "OneSpeed: ONESPEED_SUPABASE_URL must be an HTTPS URL." >&2
    exit 1
    ;;
esac

case "$url" in
  *[!a-zA-Z0-9:/._-]*)
    echo "OneSpeed: ONESPEED_SUPABASE_URL contains unsupported characters." >&2
    exit 1
    ;;
esac

case "$anon_key" in
  sb_secret_*|*[!a-zA-Z0-9._-]*)
    echo "OneSpeed: ONESPEED_SUPABASE_ANON_KEY must be a public anon/publishable key, not a secret key." >&2
    exit 1
    ;;
esac

case "$anon_key" in
  *.*.*)
    payload=${anon_key#*.}
    payload=${payload%.*}
    case $((${#payload} % 4)) in
      0) ;;
      2) payload="${payload}==" ;;
      3) payload="${payload}=" ;;
      *)
        echo "OneSpeed: ONESPEED_SUPABASE_ANON_KEY is malformed." >&2
        exit 1
        ;;
    esac
    if ! key_payload=$(printf '%s' "$payload" | tr '_-' '/+' | base64 -d 2>/dev/null); then
      echo "OneSpeed: ONESPEED_SUPABASE_ANON_KEY is malformed." >&2
      exit 1
    fi
    if printf '%s' "$key_payload" | grep -Eq '"role"[[:space:]]*:[[:space:]]*"service_role"'; then
      echo "OneSpeed: ONESPEED_SUPABASE_ANON_KEY cannot contain a service_role key." >&2
      exit 1
    fi
    ;;
esac

umask 022
config_tmp=$(mktemp /usr/share/nginx/html/js/.supabase-config.XXXXXX)
trap 'rm -f "$config_tmp"' EXIT HUP INT TERM
printf '%s\n' \
  '/* Public Supabase client configuration generated at container startup. */' \
  "window.ONESPEED_SUPABASE_CONFIG = { url: \"$url\", anonKey: \"$anon_key\" };" \
  > "$config_tmp"
chmod 644 "$config_tmp"
mv "$config_tmp" /usr/share/nginx/html/js/supabase-config.js
trap - EXIT HUP INT TERM

echo "OneSpeed: Supabase public client configuration loaded."
