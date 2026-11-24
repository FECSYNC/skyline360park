<?php
/**
 * Authenticated SMTP for Skyline waiver mailer.
 * Included by waiver-mail.php.
 *
 * Important: on staging hosts (e.g. testing.ngthub.de), localhost:465 belongs to
 * THAT server — not skyline360park.com. Connecting there first made AUTH fail and
 * never reach premium231 / mail.skyline360park.com. We now try every host for each
 * mailbox until AUTH + DATA succeed.
 */
declare(strict_types=1);

if (count(get_included_files()) === 1) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Forbidden';
    exit;
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'waiver-delivery-mail.php';

if (!function_exists('waiver_smtp_cmd')) {
    function waiver_smtp_cmd($fp, string $cmd, $expect, int $timeout = 12): bool
    {
        if ($cmd !== '') {
            fwrite($fp, $cmd . "\r\n");
        }
        $resp = waiver_smtp_read($fp, $timeout);
        $trim = trim($resp);
        $ok = false;
        if (is_array($expect)) {
            foreach ($expect as $prefix) {
                if (str_starts_with($trim, (string) $prefix)) {
                    $ok = true;
                    break;
                }
            }
        } else {
            $ok = str_starts_with($trim, (string) $expect);
        }
        if (!$ok) {
            $label = is_array($expect) ? implode('|', $expect) : (string) $expect;
            waiver_smtp_last_error(
                'SMTP cmd failed [' . $cmd . '] expect ' . $label . ' got: ' . trim(preg_replace('/\s+/', ' ', $resp))
            );
        }
        return $ok;
    }
}

if (!function_exists('waiver_smtp_host_attempts')) {
    /**
     * Ordered SMTP endpoints for a mailbox. Remote cPanel host first so staging
     * PHP does not AUTH against the wrong localhost MTA.
     *
     * @return list<array{remote:string,tls_upgrade:bool}>
     */
    function waiver_running_on_cpanel_mail_host(): bool
    {
        $blob = strtolower(implode(' ', [
            (string) ($_SERVER['HTTP_HOST'] ?? ''),
            (string) ($_SERVER['SERVER_NAME'] ?? ''),
            function_exists('gethostname') ? (string) gethostname() : '',
            php_uname('n'),
        ]));
        return str_contains($blob, 'skyline360park')
            || str_contains($blob, 'premium231')
            || str_contains($blob, 'business130');
    }

    function waiver_smtp_host_attempts(array $account): array
    {
        $host = trim((string) ($account['host'] ?? 'premium231.web-hosting.com'));
        if ($host === '') {
            $host = 'premium231.web-hosting.com';
        }
        $port = (int) ($account['port'] ?? 465);
        if ($port <= 0) {
            $port = 465;
        }
        $enc = strtolower((string) ($account['encryption'] ?? 'ssl'));

        $attempts = [];
        if ($enc === 'tls' || $port === 587) {
            $attempts[] = ['remote' => 'tcp://' . $host . ':587', 'tls_upgrade' => true];
            $attempts[] = ['remote' => 'ssl://' . $host . ':465', 'tls_upgrade' => false];
        } else {
            $attempts[] = ['remote' => 'ssl://' . $host . ':' . $port, 'tls_upgrade' => false];
            $attempts[] = ['remote' => 'tcp://' . $host . ':587', 'tls_upgrade' => true];
        }

        // Relay accounts (SendGrid / Gmail) must not fall back to Namecheap hosts.
        if (!empty($account['locked_host'])) {
            $seen = [];
            $out = [];
            foreach ($attempts as $row) {
                $key = $row['remote'];
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                $out[] = $row;
            }
            return $out;
        }

        $localFirst = [
            ['remote' => 'ssl://127.0.0.1:465', 'tls_upgrade' => false],
            ['remote' => 'tcp://127.0.0.1:587', 'tls_upgrade' => true],
        ];
        $remoteFallbacks = [
            ['remote' => 'ssl://premium231.web-hosting.com:465', 'tls_upgrade' => false],
            ['remote' => 'tcp://premium231.web-hosting.com:587', 'tls_upgrade' => true],
            ['remote' => 'ssl://mail.skyline360park.com:465', 'tls_upgrade' => false],
        ];

        // On the real cPanel box, local AUTH gets DKIM signed. Remote SMTP to
        // business130 is what Jellyfish then discards as high-probability spam.
        if (waiver_running_on_cpanel_mail_host()) {
            $attempts = array_merge($localFirst, $attempts, $remoteFallbacks);
        } else {
            $attempts = array_merge($attempts, $remoteFallbacks, $localFirst);
        }

        $seen = [];
        $out = [];
        foreach ($attempts as $row) {
            $key = $row['remote'];
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = $row;
        }
        return $out;
    }
}

if (!function_exists('waiver_smtp_open')) {
    /**
     * @return array{0:resource|null,1:bool,2:string}
     */
    function waiver_smtp_open(string $remote, bool $tlsUpgrade, int $timeout = 8): array
    {
        $ctx = waiver_smtp_ssl_context();
        $errno = 0;
        $errstr = '';
        $fp = @stream_socket_client(
            $remote,
            $errno,
            $errstr,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $ctx
        );
        if (!$fp) {
            return [null, false, ''];
        }
        stream_set_timeout($fp, 12);
        $banner = waiver_smtp_read($fp, 12);
        if (!str_starts_with(trim($banner), '220')) {
            fclose($fp);
            return [null, false, ''];
        }
        return [$fp, $tlsUpgrade, $remote];
    }
}

if (!function_exists('waiver_smtp_auth')) {
    function waiver_smtp_auth($fp, array $account, int $timeout = 12): bool
    {
        if (waiver_smtp_cmd($fp, 'AUTH LOGIN', '334', $timeout)
            && waiver_smtp_cmd($fp, base64_encode($account['user']), '334', $timeout)
            && waiver_smtp_cmd($fp, base64_encode($account['pass']), '235', $timeout)
        ) {
            return true;
        }
        $plain = base64_encode("\0" . $account['user'] . "\0" . $account['pass']);
        return waiver_smtp_cmd($fp, 'AUTH PLAIN ' . $plain, '235', $timeout);
    }
}

if (!function_exists('waiver_smtp_handshake')) {
    /**
     * EHLO (+ optional STARTTLS) then AUTH. Returns false if this host rejects the mailbox.
     */
    function waiver_smtp_handshake($fp, array $account, bool $tlsUpgrade, int $timeout = 12): bool
    {
        $ehloHost = 'skyline360park.com';
        if (!waiver_smtp_cmd($fp, 'EHLO ' . $ehloHost, '250', $timeout)
            && !waiver_smtp_cmd($fp, 'HELO ' . $ehloHost, '250', $timeout)
        ) {
            return false;
        }

        if ($tlsUpgrade) {
            if (!waiver_smtp_cmd($fp, 'STARTTLS', '220', $timeout)) {
                return false;
            }
            $crypto = defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')
                ? STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT
                : STREAM_CRYPTO_METHOD_TLS_CLIENT;
            if (!@stream_socket_enable_crypto($fp, true, $crypto)) {
                waiver_smtp_last_error('STARTTLS crypto failed');
                return false;
            }
            if (!waiver_smtp_cmd($fp, 'EHLO ' . $ehloHost, '250', $timeout)) {
                return false;
            }
        }

        if (!waiver_smtp_auth($fp, $account, $timeout)) {
            waiver_smtp_last_error('SMTP AUTH rejected for ' . $account['user']);
            return false;
        }
        return true;
    }
}

if (!function_exists('waiver_smtp_remember_host')) {
    function waiver_smtp_remember_host(?string $remote = null): string
    {
        static $good = '';
        if ($remote !== null) {
            $good = $remote;
        }
        return $good;
    }
}

if (!function_exists('waiver_smtp_build_data')) {
    function waiver_smtp_build_data(string $to, string $subjectEncoded, string $headers, string $body, string $mailFrom): string
    {
        $headers = preg_replace("/\r\n|\n|\r/", "\r\n", $headers) ?? $headers;
        $body = preg_replace("/\r\n|\n|\r/", "\r\n", $body) ?? $body;
        if (!preg_match('/^From:/mi', $headers)) {
            $headers = 'From: ' . mailbox_header('Skyline 360 Park', $mailFrom) . "\r\n" . $headers;
        } else {
            $headers = preg_replace(
                '/^From:.*$/mi',
                'From: ' . mailbox_header('Skyline 360 Park', $mailFrom),
                $headers,
                1
            ) ?? $headers;
        }
        $safeBody = preg_replace('/^\./m', '..', $body) ?? $body;
        $prefix = '';
        if (!preg_match('/^Date:/mi', $headers)) {
            $prefix .= 'Date: ' . date('r') . "\r\n";
        }
        return $prefix
            . 'Subject: ' . $subjectEncoded . "\r\n"
            . 'To: ' . $to . "\r\n"
            . $headers . "\r\n\r\n"
            . $safeBody
            . "\r\n.";
    }
}

if (!function_exists('waiver_smtp_send_data_on')) {
    /**
     * @param resource $fp
     */
    function waiver_smtp_send_data_on($fp, string $mailFrom, string $to, string $data, int $timeout = 12): bool
    {
        if (!waiver_smtp_cmd($fp, 'MAIL FROM:<' . $mailFrom . '>', ['250', '251'], $timeout)
            || !waiver_smtp_cmd($fp, 'RCPT TO:<' . $to . '>', ['250', '251'], $timeout)
            || !waiver_smtp_cmd($fp, 'DATA', '354', $timeout)
        ) {
            // Reset transaction so the same connection can send the next message.
            @fwrite($fp, "RSET\r\n");
            waiver_smtp_read($fp, 4);
            return false;
        }
        fwrite($fp, $data . "\r\n");
        $resp = waiver_smtp_read($fp, $timeout);
        $ok = str_starts_with(trim($resp), '250');
        if (!$ok) {
            waiver_smtp_last_error('SMTP DATA rejected: ' . trim(preg_replace('/\s+/', ' ', $resp)));
            @fwrite($fp, "RSET\r\n");
            waiver_smtp_read($fp, 4);
        }
        return $ok;
    }
}

if (!function_exists('waiver_smtp_envelope_from')) {
    function waiver_smtp_envelope_from(array $account): string
    {
        $from = strtolower(trim((string) ($account['from'] ?? '')));
        if ($from !== '' && filter_var($from, FILTER_VALIDATE_EMAIL)) {
            return $from;
        }
        return strtolower(trim((string) ($account['user'] ?? '')));
    }
}

if (!function_exists('waiver_smtp_relay_account')) {
    function waiver_smtp_relay_account(): ?array
    {
        $cfg = waiver_smtp_config();
        $relay = $cfg['relay'] ?? null;
        if (!is_array($relay) || empty($relay['enabled'])) {
            return null;
        }
        $user = trim((string) ($relay['user'] ?? ''));
        $pass = (string) ($relay['pass'] ?? '');
        $host = trim((string) ($relay['host'] ?? ''));
        $pass = preg_replace('/\s+/', '', $pass) ?? $pass;
        if ($user === '' || $pass === '' || $host === '') {
            return null;
        }
        if (str_contains(strtolower($user), 'your_gmail') || str_starts_with(strtolower($pass), 'xxxx')) {
            return null;
        }
        $from = strtolower(trim((string) ($relay['from'] ?? '')));
        $hostLower = strtolower($host);
        // Gmail SMTP will not send as katy@ unless that alias is added in Gmail.
        if (str_contains($hostLower, 'gmail.com') && filter_var($user, FILTER_VALIDATE_EMAIL)) {
            $from = strtolower($user);
        } elseif ($from === '' || !filter_var($from, FILTER_VALIDATE_EMAIL)) {
            $from = filter_var($user, FILTER_VALIDATE_EMAIL) ? strtolower($user) : 'katy@skyline360park.com';
        }
        return [
            'host' => $host,
            'port' => (int) ($relay['port'] ?? 587),
            'encryption' => strtolower((string) ($relay['encryption'] ?? 'tls')),
            'timeout' => (int) ($relay['timeout'] ?? 12),
            'user' => $user,
            'pass' => $pass,
            'from' => $from,
            'locked_host' => true,
        ];
    }
}

if (!function_exists('waiver_smtp_send_message')) {
    function waiver_smtp_send_message(
        string $to,
        string $subjectEncoded,
        string $headers,
        string $body,
        string $envelopeFrom
    ): bool {
        $results = waiver_smtp_send_messages([
            [
                'to' => $to,
                'subject' => $subjectEncoded,
                'headers' => $headers,
                'body' => $body,
            ],
        ], $envelopeFrom);
        return !empty($results[0]['ok']);
    }
}

if (!function_exists('waiver_smtp_send_messages')) {
    /**
     * Authenticate once, then send one or more messages on the same SMTP session.
     *
     * @param list<array{to:string,subject:string,headers:string,body:string}> $messages
     * @return list<array{ok:bool,detail:string,to:string}>
     */
    function waiver_smtp_send_messages(array $messages, string $envelopeFrom): array
    {
        $account = waiver_smtp_account($envelopeFrom);
        $out = [];
        foreach ($messages as $msg) {
            $to = trim((string) ($msg['to'] ?? ''));
            $out[] = [
                'ok' => false,
                'detail' => 'not attempted',
                'to' => $to,
            ];
        }
        if (!$account) {
            foreach ($out as $i => $_) {
                $out[$i]['detail'] = 'No SMTP account';
            }
            return $out;
        }

        $prepared = [];
        foreach ($messages as $i => $msg) {
            $to = trim((string) ($msg['to'] ?? ''));
            if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
                $out[$i]['detail'] = 'Invalid recipient';
                continue;
            }
            $prepared[$i] = [
                'to' => $to,
                'data' => waiver_smtp_build_data(
                    $to,
                    (string) ($msg['subject'] ?? ''),
                    (string) ($msg['headers'] ?? ''),
                    (string) ($msg['body'] ?? ''),
                    waiver_smtp_envelope_from($account)
                ),
            ];
        }
        if (!$prepared) {
            return $out;
        }

        $timeout = 12;
        $mailFrom = waiver_smtp_envelope_from($account);
        $errors = [];
        $attempts = waiver_smtp_host_attempts($account);
        $remembered = waiver_smtp_remember_host();
        if ($remembered !== '' && empty($account['locked_host'])) {
            array_unshift($attempts, [
                'remote' => $remembered,
                'tls_upgrade' => str_starts_with($remembered, 'tcp://'),
            ]);
        }

        $seen = [];
        foreach ($attempts as $attempt) {
            $remote = $attempt['remote'];
            if (isset($seen[$remote])) {
                continue;
            }
            $seen[$remote] = true;

            [$fp, $tlsUpgrade, $remoteOpen] = waiver_smtp_open($remote, !empty($attempt['tls_upgrade']), 6);
            if (!$fp) {
                continue;
            }
            if (!waiver_smtp_handshake($fp, $account, $tlsUpgrade, $timeout)) {
                $errors[] = $remoteOpen . ': ' . waiver_smtp_last_error();
                @fwrite($fp, "QUIT\r\n");
                fclose($fp);
                continue;
            }

            waiver_smtp_remember_host($remoteOpen);
            $allOk = true;
            foreach ($prepared as $i => $row) {
                // Skip recipients already accepted on an earlier host.
                if (!empty($out[$i]['ok'])) {
                    continue;
                }
                $ok = waiver_smtp_send_data_on($fp, $mailFrom, $row['to'], $row['data'], $timeout);
                if ($ok) {
                    // Clean boundary between messages on picky MTAs.
                    @fwrite($fp, "RSET\r\n");
                    waiver_smtp_read($fp, 4);
                } else {
                    $allOk = false;
                }
                $out[$i] = [
                    'ok' => $ok,
                    'detail' => $ok
                        ? ('SMTP OK via ' . $remoteOpen . ' as ' . $mailFrom . ' -> ' . $row['to'])
                        : waiver_smtp_last_error(),
                    'to' => $row['to'],
                ];
            }
            @fwrite($fp, "QUIT\r\n");
            fclose($fp);

            $pending = false;
            foreach ($prepared as $i => $_) {
                if (empty($out[$i]['ok'])) {
                    $pending = true;
                    break;
                }
            }
            if (!$pending) {
                waiver_smtp_last_error('SMTP batch OK via ' . $remoteOpen . ' as ' . $mailFrom);
                return $out;
            }
            // Keep trying other hosts for any remaining failures.
            if (!$allOk) {
                continue;
            }
        }

        waiver_smtp_last_error(
            $errors
                ? ('SMTP failed for ' . $mailFrom . ' | ' . implode(' || ', array_slice($errors, 0, 4)))
                : ('Could not open any SMTP host for ' . $mailFrom)
        );
        return $out;
    }
}

if (!function_exists('waiver_recipient_is_local')) {
    function waiver_recipient_is_local(string $email): bool
    {
        $domain = strtolower((string) substr(strrchr($email, '@') ?: '', 1));
        return $domain === 'skyline360park.com';
    }
}

if (!function_exists('waiver_php_mail_send')) {
    function waiver_php_mail_send(
        string $to,
        string $subjectEncoded,
        string $headers,
        string $body,
        string $envelopeFrom
    ): bool {
        $to = trim($to);
        $envelopeFrom = strtolower(trim($envelopeFrom));
        if (!filter_var($to, FILTER_VALIDATE_EMAIL) || !filter_var($envelopeFrom, FILTER_VALIDATE_EMAIL)) {
            return false;
        }
        // Namecheap rejects unauthenticated PHP mail() (bounce: "Relaying not
        // permitted"). Park notices and guest copies both use authenticated SMTP.
        waiver_smtp_last_error('PHP mail() skipped (unauthenticated local send is rejected as relay)');
        return false;
    }
}

if (!function_exists('waiver_compose_mail_parts')) {
    /**
     * @param array{mime?:string,ext?:string,bytes?:string,filename?:string,cid?:string}|null $inlineImage
     * @return array{subject:string,headers:string,body:string}
     */
    function waiver_compose_mail_parts(
        string $subject,
        string $plain,
        string $html,
        string $fromEmail,
        string $replyTo,
        string $replyName = '',
        ?array $inlineImage = null
    ): array {
        $fromEmail = strtolower(trim($fromEmail));
        $replyTo = strtolower(trim($replyTo));
        if ($replyTo === '' || !filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
            $replyTo = $fromEmail;
        }
        $replyHeader = $replyName !== ''
            ? mailbox_header($replyName, $replyTo)
            : $replyTo;

        $plainBody = mail_limit_lines($plain, 900);
        $htmlBody = trim($html);
        $hasInline = $inlineImage
            && !empty($inlineImage['bytes'])
            && is_string($inlineImage['bytes']);

        if ($htmlBody !== '') {
            $boundaryAlt = 'sky_alt_' . bin2hex(random_bytes(6));
            $altPart = "--{$boundaryAlt}\r\n"
                . "Content-Type: text/plain; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                . mail_qp($plainBody) . "\r\n"
                . "--{$boundaryAlt}\r\n"
                . "Content-Type: text/html; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                . mail_qp($htmlBody) . "\r\n"
                . "--{$boundaryAlt}--\r\n";

            if ($hasInline) {
                $boundaryRel = 'sky_rel_' . bin2hex(random_bytes(6));
                $filename = preg_replace('/[^A-Za-z0-9._-]/', '', (string) ($inlineImage['filename'] ?? 'waiver-signature.jpg')) ?: 'waiver-signature.jpg';
                $mime = (string) ($inlineImage['mime'] ?? 'image/jpeg');
                $cid = preg_replace('/[^A-Za-z0-9._@-]/', '', (string) ($inlineImage['cid'] ?? 'skyline-waiver-signature')) ?: 'skyline-waiver-signature';
                $b64 = chunk_split(base64_encode((string) $inlineImage['bytes']), 76, "\r\n");
                // multipart/related so the drawn signature shows inside the HTML body.
                $body = "--{$boundaryRel}\r\n"
                    . "Content-Type: multipart/alternative; boundary=\"{$boundaryAlt}\"\r\n\r\n"
                    . $altPart . "\r\n"
                    . "--{$boundaryRel}\r\n"
                    . 'Content-Type: ' . $mime . '; name="' . $filename . "\"\r\n"
                    . "Content-Transfer-Encoding: base64\r\n"
                    . 'Content-ID: <' . $cid . ">\r\n"
                    . 'Content-Disposition: inline; filename="' . $filename . "\"\r\n\r\n"
                    . $b64
                    . "--{$boundaryRel}--\r\n";
                $contentType = 'multipart/related; type="multipart/alternative"; boundary="' . $boundaryRel . '"';
            } else {
                $body = $altPart;
                $contentType = 'multipart/alternative; boundary="' . $boundaryAlt . '"';
            }
        } else {
            $body = $plainBody;
            $contentType = 'text/plain; charset=UTF-8';
        }

        $fromDisplay = 'Skyline 360 Park';
        $fromHeader = mailbox_header($fromDisplay, $fromEmail);
        $headers = implode("\r\n", [
            'MIME-Version: 1.0',
            'Content-Type: ' . $contentType,
            'From: ' . $fromHeader,
            'Sender: ' . $fromHeader,
            'Reply-To: ' . $replyHeader,
            'Organization: SKYLINE360PARK',
            'Date: ' . date('r'),
            'X-Mailer: SKYLINE360PARK-Waiver',
            'X-Entity-Ref-ID: waiver-' . bin2hex(random_bytes(6)),
            'Message-ID: <waiver-' . bin2hex(random_bytes(8)) . '@skyline360park.com>',
        ]);

        return [
            'subject' => encode_header($subject),
            'headers' => $headers,
            'body' => $body,
        ];
    }
}

if (!function_exists('waiver_guest_smtp_accounts')) {
    /**
     * SMTP mailboxes that can actually relay to Gmail (must have a password).
     *
     * @return list<string>
     */
    function waiver_guest_smtp_accounts(string $preferredFrom): array
    {
        $out = [];
        $preferredFrom = strtolower(trim($preferredFrom));
        $cfg = waiver_smtp_config();
        $accounts = is_array($cfg['accounts'] ?? null) ? $cfg['accounts'] : [];
        if ($preferredFrom !== '' && !empty($accounts[$preferredFrom]['pass'])) {
            $out[] = $preferredFrom;
        }
        foreach ($accounts as $email => $row) {
            $email = strtolower((string) $email);
            if ($email === '' || in_array($email, $out, true)) {
                continue;
            }
            if (is_array($row) && trim((string) ($row['pass'] ?? '')) !== '') {
                $out[] = $email;
            }
        }
        return $out;
    }
}

if (!function_exists('waiver_compose_guest_parts')) {
    /**
     * Plain transactional guest message — no bulk headers (X-Mailer / X-Entity-Ref-ID
     * make Namecheap Jellyfish treat the copy as spam).
     *
     * @return array{subject:string,headers:string,body:string}
     */
    function waiver_compose_guest_parts(
        string $subject,
        string $plain,
        string $fromEmail,
        string $replyTo = '',
        string $replyName = '',
        string $html = ''
    ): array {
        $fromEmail = strtolower(trim($fromEmail));
        $replyTo = strtolower(trim($replyTo));
        if ($replyTo === '' || !filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
            $replyTo = $fromEmail;
        }
        $fromDisplay = trim($replyName) !== '' ? trim($replyName) : 'Skyline 360 Park';
        $fromHeader = mailbox_header($fromDisplay, $fromEmail);
        $replyHeader = mailbox_header($fromDisplay, $replyTo);
        $plainBody = mail_limit_lines($plain, 900);
        $htmlBody = trim($html);

        if ($htmlBody !== '') {
            $boundaryAlt = 'sky_alt_' . bin2hex(random_bytes(8));
            $body = "--{$boundaryAlt}\r\n"
                . "Content-Type: text/plain; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                . mail_qp($plainBody) . "\r\n"
                . "--{$boundaryAlt}\r\n"
                . "Content-Type: text/html; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                . mail_qp($htmlBody) . "\r\n"
                . "--{$boundaryAlt}--\r\n";
            $contentType = 'multipart/alternative; boundary="' . $boundaryAlt . '"';
        } else {
            $body = $plainBody;
            $contentType = 'text/plain; charset=UTF-8';
        }

        $body = mail_limit_lines($body, 900);

        $headers = implode("\r\n", [
            'MIME-Version: 1.0',
            'Content-Type: ' . $contentType,
            'From: ' . $fromHeader,
            'Sender: ' . $fromHeader,
            'Reply-To: ' . $replyHeader,
            'Organization: SKYLINE360PARK',
            'Message-ID: <waiver-guest-' . bin2hex(random_bytes(10)) . '@skyline360park.com>',
            'Date: ' . date('r'),
        ]);
        return [
            'subject' => encode_header($subject),
            'headers' => $headers,
            'body' => $body,
        ];
    }
}

if (!function_exists('waiver_smtp_send_via_account')) {
    function waiver_smtp_send_via_account(
        string $to,
        string $subjectEncoded,
        string $headers,
        string $body,
        array $account,
        bool $fast = false
    ): bool {
        $mailFrom = waiver_smtp_envelope_from($account);
        if ($mailFrom === '' || !filter_var($mailFrom, FILTER_VALIDATE_EMAIL)) {
            return false;
        }
        $prepared = [[
            'to' => $to,
            'data' => waiver_smtp_build_data($to, $subjectEncoded, $headers, $body, $mailFrom),
        ]];
        $timeout = $fast ? 6 : 8;
        if ($fast) {
            $attempts = [
                ['remote' => 'ssl://127.0.0.1:465', 'tls_upgrade' => false],
                ['remote' => 'tcp://127.0.0.1:587', 'tls_upgrade' => true],
            ];
        } else {
            $attempts = waiver_smtp_host_attempts($account);
            $remembered = waiver_smtp_remember_host();
            if ($remembered !== '') {
                array_unshift($attempts, ['remote' => $remembered, 'tls_upgrade' => str_starts_with($remembered, 'tcp://')]);
            }
        }
        $seen = [];
        foreach ($attempts as $attempt) {
            $remote = $attempt['remote'];
            if (isset($seen[$remote])) {
                continue;
            }
            $seen[$remote] = true;
            [$fp, $tlsUpgrade, $remoteOpen] = waiver_smtp_open($remote, !empty($attempt['tls_upgrade']), $fast ? 2 : 3);
            if (!$fp) {
                continue;
            }
            if (!waiver_smtp_handshake($fp, $account, $tlsUpgrade, $timeout)) {
                @fwrite($fp, "QUIT\r\n");
                fclose($fp);
                continue;
            }
            waiver_smtp_remember_host($remoteOpen);
            $ok = waiver_smtp_send_data_on($fp, $mailFrom, $to, $prepared[0]['data'], $timeout);
            @fwrite($fp, "QUIT\r\n");
            fclose($fp);
            if ($ok) {
                waiver_smtp_last_error('SMTP OK via ' . $remoteOpen . ' as ' . $mailFrom . ' -> ' . $to);
                return true;
            }
        }
        return false;
    }
}

if (!function_exists('waiver_send_franchise_style')) {
    /**
     * PHP mail() that Namecheap will relay to Gmail/Outlook.
     * Visible From/Reply-To are the park mailbox. Envelope (-f) stays a
     * local mailbox Exim already allows, so park@ is not used as -f
     * (that bounce is “Relaying not permitted” to the park inbox).
     */
    function waiver_send_franchise_style(
        string $to,
        string $subject,
        string $plain,
        string $html = '',
        string $fromEmail = 'katy@skyline360park.com',
        string $fromName = 'Skyline 360 Park'
    ): bool {
        $to = trim($to);
        $fromEmail = strtolower(trim($fromEmail));
        $fromName = trim(str_replace(['"', "\r", "\n", '<', '>'], '', $fromName));
        if ($fromName === '') {
            $fromName = 'Skyline 360 Park';
        }
        if (!filter_var($to, FILTER_VALIDATE_EMAIL) || !filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
            return false;
        }
        $fromDomain = strtolower((string) substr(strrchr($fromEmail, '@') ?: '', 1));
        if ($fromDomain !== 'skyline360park.com') {
            return false;
        }

        $from = mailbox_header($fromName, $fromEmail);
        $encodedSubject = encode_header($subject);
        $html = trim($html);

        if ($html !== '') {
            $boundaryAlt = 'sky_alt_' . bin2hex(random_bytes(8));
            $body = "--{$boundaryAlt}\r\n"
                . "Content-Type: text/plain; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                . mail_qp($plain) . "\r\n"
                . "--{$boundaryAlt}\r\n"
                . "Content-Type: text/html; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
                . mail_qp($html) . "\r\n"
                . "--{$boundaryAlt}--\r\n";
            $body = mail_limit_lines($body, 900);
            $contentType = 'multipart/alternative; boundary="' . $boundaryAlt . '"';
        } else {
            $body = mail_limit_lines($plain, 900);
            $contentType = 'text/plain; charset=UTF-8';
        }

        $headers = [
            'MIME-Version: 1.0',
            'Content-Type: ' . $contentType,
            'From: ' . $from,
            'Sender: ' . $from,
            'Reply-To: ' . $from,
            'Organization: SKYLINE360PARK',
            'X-Mailer: SKYLINE360PARK-Waiver',
            'X-Entity-Ref-ID: skyline360park-waiver-' . bin2hex(random_bytes(4)),
            'Message-ID: <waiver-' . bin2hex(random_bytes(10)) . '@skyline360park.com>',
            'Date: ' . date('r'),
        ];
        $headerBlock = implode("\r\n", $headers);

        // Envelope is the waiver delivery mailbox, not franchise@.
        // From still has to match that mailbox or Exim rejects as relay.
        $envelope = 'delivery@skyline360park.com';
        $sent = @mail($to, $encodedSubject, $body, $headerBlock, '-f' . $envelope);
        if (!$sent) {
            $sent = @mail($to, $encodedSubject, $body, $headerBlock);
        }
        if ($sent) {
            waiver_smtp_last_error('PHP mail() OK From ' . $fromEmail . ' -> ' . $to);
        }
        return (bool) $sent;
    }
}

if (!function_exists('waiver_php_mail_exact')) {
    function waiver_php_mail_exact(
        string $to,
        string $subject,
        string $plain,
        string $html,
        string $fromEmail,
        string $fromName,
        string $replyTo = '',
        string $replyName = ''
    ): bool {
        unset($replyTo, $replyName);
        return waiver_send_franchise_style($to, $subject, $plain, $html, $fromEmail, $fromName);
    }
}

if (!function_exists('waiver_force_send_guest')) {
    /**
     * Customer copy via waiver-delivery-mail.php (PHP mail(), same as franchise).
     * From + envelope are delivery@skyline360park.com. Reply-To is the park.
     * Park inbox notices stay on authenticated SMTP (unchanged).
     *
     * @return array{ok:bool,detail:string}
     */
    function waiver_force_send_guest(
        string $to,
        string $subject,
        string $plain,
        string $html,
        string $preferredFrom,
        string $replyTo = '',
        string $replyName = ''
    ): array {
        $to = trim($to);
        $parkEmail = strtolower(trim($preferredFrom));
        $fromName = trim($replyName);
        $replyTo = strtolower(trim($replyTo));
        if ($replyTo === '' || !filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
            $replyTo = $parkEmail;
        }
        if ($fromName === '') {
            $fromName = 'Skyline 360 Park';
        }
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return ['ok' => false, 'detail' => 'Invalid recipient'];
        }

        if (waiver_delivery_send_guest($to, $subject, $html, $plain, $fromName, $replyTo)) {
            return [
                'ok' => true,
                'detail' => 'Delivery mailer From ' . WAIVER_DELIVERY_FROM . ' Reply-To ' . $replyTo . ' -> ' . $to,
            ];
        }
        if (trim($html) !== '' && waiver_delivery_send_guest($to, $subject, '', $plain, $fromName, $replyTo)) {
            return [
                'ok' => true,
                'detail' => 'Delivery mailer plain From ' . WAIVER_DELIVERY_FROM . ' -> ' . $to,
            ];
        }

        return [
            'ok' => false,
            'detail' => 'Delivery mailer failed for ' . $to,
        ];
    }
}

if (!function_exists('waiver_force_send_park')) {
    /**
     * Park inbox: authenticated SMTP only. PHP mail() to katy@ is rejected as
     * "Relaying not permitted" even when To and From are both katy@.
     *
     * @return array{ok:bool,detail:string}
     */
    function waiver_force_send_park(
        string $to,
        string $subject,
        string $plain,
        string $html,
        string $fromEmail,
        string $replyTo = '',
        string $replyName = '',
        ?array $inlineImage = null,
        bool $fast = false
    ): array {
        $to = trim($to);
        $fromEmail = strtolower(trim($fromEmail));
        if (!filter_var($to, FILTER_VALIDATE_EMAIL) || !filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
            return ['ok' => false, 'detail' => 'Invalid park mailbox'];
        }
        if (!waiver_recipient_is_local($to)) {
            return ['ok' => false, 'detail' => 'Park notice must stay on skyline360park.com'];
        }

        $account = waiver_smtp_account($fromEmail);
        if (!$account) {
            return ['ok' => false, 'detail' => 'No SMTP password for ' . $fromEmail];
        }

        $send = static function (?array $image) use ($to, $subject, $plain, $html, $fromEmail, $replyTo, $replyName, $account, $fast): bool {
            $parts = waiver_compose_mail_parts(
                $subject,
                $plain,
                $html,
                $fromEmail,
                $replyTo,
                $replyName,
                $image
            );
            return waiver_smtp_send_via_account(
                $to,
                $parts['subject'],
                $parts['headers'],
                $parts['body'],
                $account,
                $fast
            );
        };

        if ($send($inlineImage)) {
            return ['ok' => true, 'detail' => waiver_smtp_last_error()];
        }
        if ($inlineImage && $send(null)) {
            return ['ok' => true, 'detail' => waiver_smtp_last_error()];
        }

        return [
            'ok' => false,
            'detail' => waiver_smtp_last_error() ?: ('SMTP failed for ' . $to),
        ];
    }
}

if (!function_exists('waiver_force_send')) {
    /**
     * @return array{ok:bool,detail:string}
     */
    function waiver_force_send(
        string $to,
        string $subject,
        string $plain,
        string $html,
        string $preferredFrom,
        string $replyTo = '',
        string $replyName = '',
        ?array $inlineImage = null
    ): array {
        $pair = waiver_force_send_pair(
            [
                'to' => $to,
                'subject' => $subject,
                'plain' => $plain,
                'html' => $html,
                'reply_to' => $replyTo,
                'reply_name' => $replyName,
                'inline_image' => $inlineImage,
            ],
            null,
            $preferredFrom
        );
        return $pair['first'];
    }
}

if (!function_exists('waiver_force_send_pair')) {
    /**
     * Send guest + park copies with one SMTP login when possible.
     *
     * @param array{to:string,subject:string,plain:string,html:string,reply_to?:string,reply_name?:string,inline_image?:?array} $first
     * @param array{to:string,subject:string,plain:string,html:string,reply_to?:string,reply_name?:string,inline_image?:?array}|null $second
     * @return array{first:array{ok:bool,detail:string},second:?array{ok:bool,detail:string}}
     */
    function waiver_force_send_pair(array $first, ?array $second, string $preferredFrom): array
    {
        $preferredFrom = strtolower(trim($preferredFrom));
        $cfg = waiver_smtp_config();
        $accounts = [];
        if ($preferredFrom !== '' && !empty($cfg['accounts'][$preferredFrom]['pass'])) {
            $accounts[] = $preferredFrom;
        }
        foreach ($cfg['accounts'] as $email => $row) {
            $email = strtolower((string) $email);
            if ($email === '' || in_array($email, $accounts, true)) {
                continue;
            }
            if (is_array($row) && trim((string) ($row['pass'] ?? '')) !== '') {
                $accounts[] = $email;
            }
        }
        if (!$accounts && $preferredFrom !== '') {
            $accounts[] = $preferredFrom;
        }

        $empty = ['ok' => false, 'detail' => 'No SMTP mailbox passwords configured'];
        if (!$accounts) {
            return ['first' => $empty, 'second' => $second ? $empty : null];
        }

        $pack = static function (array $msg, string $fromEmail): ?array {
            $to = trim((string) ($msg['to'] ?? ''));
            if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
                return null;
            }
            $inline = isset($msg['inline_image']) && is_array($msg['inline_image']) ? $msg['inline_image'] : null;
            $parts = waiver_compose_mail_parts(
                (string) ($msg['subject'] ?? ''),
                (string) ($msg['plain'] ?? ''),
                (string) ($msg['html'] ?? ''),
                $fromEmail,
                (string) ($msg['reply_to'] ?? ''),
                (string) ($msg['reply_name'] ?? ''),
                $inline
            );
            return [
                'to' => $to,
                'subject' => $parts['subject'],
                'headers' => $parts['headers'],
                'body' => $parts['body'],
            ];
        };

        $firstResult = ['ok' => false, 'detail' => 'Invalid recipient'];
        $secondResult = $second ? ['ok' => false, 'detail' => 'Invalid recipient'] : null;

        foreach ($accounts as $authUser) {
            $batch = [];
            $map = [];
            $p1 = $pack($first, $authUser);
            if ($p1) {
                $map[] = 'first';
                $batch[] = $p1;
            } else {
                $firstResult = ['ok' => false, 'detail' => 'Invalid recipient'];
            }
            if ($second) {
                $p2 = $pack($second, $authUser);
                if ($p2) {
                    $map[] = 'second';
                    $batch[] = $p2;
                } else {
                    $secondResult = ['ok' => false, 'detail' => 'Invalid recipient'];
                }
            }
            if (!$batch) {
                continue;
            }

            $smtpRows = waiver_smtp_account($authUser)
                ? waiver_smtp_send_messages($batch, $authUser)
                : [];

            foreach ($smtpRows as $i => $row) {
                $key = $map[$i] ?? '';
                if ($key === 'first') {
                    $firstResult = ['ok' => !empty($row['ok']), 'detail' => (string) ($row['detail'] ?? '')];
                } elseif ($key === 'second') {
                    $secondResult = ['ok' => !empty($row['ok']), 'detail' => (string) ($row['detail'] ?? '')];
                }
            }

            // PHP mail() fallback for any still-failed recipients.
            foreach ($batch as $i => $msg) {
                $key = $map[$i] ?? '';
                $current = $key === 'second' ? $secondResult : $firstResult;
                if (!empty($current['ok'])) {
                    continue;
                }
                if (waiver_php_mail_send($msg['to'], $msg['subject'], $msg['headers'], $msg['body'], $authUser)) {
                    $okRow = ['ok' => true, 'detail' => waiver_smtp_last_error()];
                    if ($key === 'second') {
                        $secondResult = $okRow;
                    } else {
                        $firstResult = $okRow;
                    }
                }
            }

            $firstOk = !empty($firstResult['ok']);
            $secondOk = $second === null || !empty($secondResult['ok']);
            if ($firstOk && $secondOk) {
                return ['first' => $firstResult, 'second' => $secondResult];
            }
        }

        return ['first' => $firstResult, 'second' => $secondResult];
    }
}
