<?php
declare(strict_types=1);

// The listener is host-loopback-only. The JWT gateway strips any client value
// and sets this one exact header after validating the Cloudflare Access token.
$forwardedUser = trim((string)($_SERVER['HTTP_X_FORWARDED_USER'] ?? ''));
if ($forwardedUser === 'owner@example.com') {
    $_SERVER['REMOTE_USER'] = $forwardedUser;
}
