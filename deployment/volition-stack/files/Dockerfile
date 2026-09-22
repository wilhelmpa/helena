# syntax=docker/dockerfile:1.7

FROM docker.io/library/nextcloud:34.0.4-apache@sha256:a5ace30c695afe48c2c406e940ee7886a81e13fa382e57cd68b2416d1a66914c

ADD --checksum=sha256:55e6b3a797442d6a5e6dbfc274f08760aa15b3e8efc82d6c29563565ec1adfff \
  https://github.com/nextcloud-releases/user_saml/releases/download/v8.3.1/user_saml-v8.3.1.tar.gz \
  /tmp/user_saml.tar.gz

RUN tar -xzf /tmp/user_saml.tar.gz -C /usr/src/nextcloud/custom_apps \
    && rm /tmp/user_saml.tar.gz \
    && chown -R www-data:www-data /usr/src/nextcloud/custom_apps/user_saml

COPY remote-user.conf /etc/apache2/conf-available/remote-user.conf
COPY remote-user.php /usr/local/etc/php/volition-remote-user.php
COPY remote-user.ini /usr/local/etc/php/conf.d/zz-volition-remote-user.ini
COPY nextcloud-entrypoint.sh /usr/local/bin/volition-nextcloud-entrypoint
RUN a2enconf remote-user \
    && chmod 0755 /usr/local/bin/volition-nextcloud-entrypoint

ENTRYPOINT ["/usr/local/bin/volition-nextcloud-entrypoint"]
CMD ["apache2-foreground"]
