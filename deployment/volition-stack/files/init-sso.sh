#!/bin/sh
set -eu

redis_secret_source="${VOLITION_REDIS_SECRET_SOURCE:-${REDIS_HOST_PASSWORD_FILE:-}}"
if [ -n "${redis_secret_source}" ] && [ -r "${redis_secret_source}" ]; then
  install -d -m 0750 -o root -g www-data /run/volition-secrets
  install -m 0400 -o www-data -g www-data "${redis_secret_source}" /run/volition-secrets/redis_password
  export REDIS_HOST_PASSWORD_FILE=/run/volition-secrets/redis_password
fi

occ="php /var/www/html/occ"
as_www_data() {
  su -s /bin/sh www-data -c "$1"
}

as_www_data "$occ app:enable user_saml"
as_www_data "$occ app:disable firstrunwizard"
as_www_data "$occ app:disable nextcloud_announcements"
as_www_data "$occ app:disable recommendations"
as_www_data "$occ app:disable survey_client"
as_www_data "$occ config:app:set user_saml type --value=environment-variable"
as_www_data "$occ config:app:set user_saml general-require_provisioned_account --value=0"
as_www_data "$occ config:app:set user_saml general-allow_multiple_user_back_ends --value=1"
as_www_data "$occ config:app:set user_saml general-nextcloud_login_form --value=0"

if ! as_www_data "$occ saml:config:get --providerId 1 --output=json" >/dev/null 2>&1; then
  as_www_data "$occ saml:config:create"
fi

as_www_data "$occ saml:config:set --general-uid_mapping=REMOTE_USER --saml-attribute-mapping-displayName_mapping=REMOTE_USER --saml-attribute-mapping-email_mapping=REMOTE_USER 1"
