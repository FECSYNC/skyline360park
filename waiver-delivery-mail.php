<?php
/**
 * Skyline 360 Park — waiver customer-copy PHP mailer
 *
 * Cloned from franchise-mail.php’s working PHP mail() path.
 * Franchise keeps franchise@skyline360park.com.
 * Waiver customer copies use this file and delivery@skyline360park.com.
 *
 * Namecheap only relays PHP mail() to Gmail when From and envelope (-f)
 * are the SAME local mailbox. That is why franchise works, and why From
 * katy@ + envelope franchise@ bounced as “Relaying not permitted”.
 *
 * Create the mailbox delivery@skyline360park.com in cPanel before go-live.
 * Included by waiver-mail.php. Do not post the waiver form to this file.
 */
declare(strict_types=1);

if (count(get_included_files()) === 1) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Forbidden';
    exit;
}

const WAIVER_DELIVERY_FROM = 'delivery@skyline360park.com';
const WAIVER_DELIVERY_FROM_NAME = 'SKYLINE360PARK';

if (!function_exists('waiver_delivery_encode_header')) {
    function waiver_delivery_encode_header(string $value): string
    {
        $value = trim(str_replace(["\r", "\n"], '', $value));
        if ($value === '') {
            return '';
        }
        if (function_exists('mb_encode_mimeheader') && preg_match('/[^\x20-\x7E]/', $value)) {
            return mb_encode_mimeheader($value, 'UTF-8', 'Q');
        }
        return $value;
    }
}

if (!function_exists('waiver_delivery_mailbox_header')) {
    function waiver_delivery_mailbox_header(string $name, string $email): string
    {
        $valid = filter_var($email, FILTER_VALIDATE_EMAIL);
        $email = $valid ?: WAIVER_DELIVERY_FROM;
        $name = trim(str_replace(['"', "\r", "\n", '<', '>'], '', $name));
        if ($name === '') {
            return $email;
        }
        return '"' . waiver_delivery_encode_header($name) . '" <' . $email . '>';
    }
}

if (!function_exists('waiver_delivery_limit_lines')) {
    function waiver_delivery_limit_lines(string $value, int $max = 900): string
    {
        $value = str_replace(["\r\n", "\r"], "\n", $value);
        $out = [];
        foreach (explode("\n", $value) as $line) {
            if (strlen($line) <= $max) {
                $out[] = $line;
                continue;
            }
            while (strlen($line) > $max) {
                $out[] = substr($line, 0, $max);
                $line = substr($line, $max);
            }
            if ($line !== '') {
                $out[] = $line;
            }
        }
        return implode("\r\n", $out);
    }
}

if (!function_exists('waiver_delivery_qp')) {
    function waiver_delivery_qp(string $value): string
    {
        $value = str_replace(["\r\n", "\r"], "\n", $value);
        $encoded = function_exists('quoted_printable_encode')
            ? quoted_printable_encode($value)
            : waiver_delivery_limit_lines($value, 76);
        return waiver_delivery_limit_lines($encoded, 76);
    }
}

if (!function_exists('waiver_delivery_send_branded_mail')) {
    /**
     * Same PHP mail() pattern as franchise-mail.php send_branded_mail(),
     * with delivery@ as From, Sender, and envelope instead of franchise@.
     */
    function waiver_delivery_send_branded_mail(
        string $to,
        string $subject,
        string $html,
        string $plain,
        string $replyName,
        string $replyEmail,
        ?string $logoData = null,
        string $logoCid = '',
        bool $embedLogo = false,
        string $bcc = ''
    ): bool {
        $to = trim($to);
        $bcc = trim($bcc);
        if ($to === '') {
            return false;
        }
        if (strpos($to, ',') === false && !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return false;
        }

        unset($logoData, $logoCid, $embedLogo);

        $boundaryAlt = 'sky_alt_' . bin2hex(random_bytes(8));
        $encodedSubject = waiver_delivery_encode_header($subject);
        $fromName = trim($replyName) !== '' ? trim($replyName) : WAIVER_DELIVERY_FROM_NAME;
        $from = waiver_delivery_mailbox_header($fromName, WAIVER_DELIVERY_FROM);
        $replyTo = strtolower(trim($replyEmail));
        if (!filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
            $replyTo = WAIVER_DELIVERY_FROM;
        }
        $reply = waiver_delivery_mailbox_header($fromName, $replyTo);

        $plainPart = waiver_delivery_qp($plain);
        $htmlPart = waiver_delivery_qp($html);

        $body = "--{$boundaryAlt}\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
            . $plainPart . "\r\n"
            . "--{$boundaryAlt}\r\n"
            . "Content-Type: text/html; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
            . $htmlPart . "\r\n"
            . "--{$boundaryAlt}--\r\n";

        $body = waiver_delivery_limit_lines($body, 900);
        $contentType = 'multipart/alternative; boundary="' . $boundaryAlt . '"';

        $headers = [
            'MIME-Version: 1.0',
            'Content-Type: ' . $contentType,
            'From: ' . $from,
            'Sender: ' . $from,
            'Reply-To: ' . $reply,
            'Organization: SKYLINE360PARK',
            'X-Mailer: SKYLINE360PARK-Waiver-Delivery',
            'X-Entity-Ref-ID: skyline360park-waiver-' . bin2hex(random_bytes(4)),
            'Message-ID: <waiver-delivery-' . bin2hex(random_bytes(10)) . '@skyline360park.com>',
            'Date: ' . date('r'),
        ];
        if ($bcc !== '') {
            $headers[] = 'Bcc: ' . $bcc;
        }
        $headerBlock = implode("\r\n", $headers);

        $sent = @mail($to, $encodedSubject, $body, $headerBlock, '-f' . WAIVER_DELIVERY_FROM);
        if (!$sent) {
            $sent = @mail($to, $encodedSubject, $body, $headerBlock);
        }
        return (bool) $sent;
    }
}

if (!function_exists('waiver_delivery_send_guest')) {
    /**
     * Confirmation to the guest — same two-step path as
     * franchise-mail.php send_applicant_confirmation().
     * One branded attempt, then an immediate plain-text fallback.
     */
    function waiver_delivery_send_guest(
        string $to,
        string $subject,
        string $html,
        string $plain,
        string $replyName = '',
        string $replyEmail = ''
    ): bool {
        $to = trim($to);
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return false;
        }

        $replyName = trim($replyName);
        if ($replyName === '') {
            $replyName = WAIVER_DELIVERY_FROM_NAME;
        }
        $replyEmail = strtolower(trim($replyEmail));
        if (!filter_var($replyEmail, FILTER_VALIDATE_EMAIL)) {
            $replyEmail = WAIVER_DELIVERY_FROM;
        }

        if (waiver_delivery_send_branded_mail(
            $to,
            $subject,
            $html,
            $plain,
            $replyName,
            $replyEmail,
            null,
            'skyline360park-logo',
            false
        )) {
            return true;
        }

        $encodedSubject = waiver_delivery_encode_header($subject);
        $from = waiver_delivery_mailbox_header($replyName, WAIVER_DELIVERY_FROM);
        $reply = waiver_delivery_mailbox_header($replyName, $replyEmail);
        $headers = [
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'From: ' . $from,
            'Sender: ' . $from,
            'Reply-To: ' . $reply,
            'Organization: SKYLINE360PARK',
            'X-Mailer: SKYLINE360PARK-Waiver-Delivery',
            'Message-ID: <waiver-delivery-plain-' . bin2hex(random_bytes(8)) . '@skyline360park.com>',
            'Date: ' . date('r'),
        ];
        $headerBlock = implode("\r\n", $headers);
        $plainSafe = waiver_delivery_limit_lines($plain, 900);
        $sent = @mail($to, $encodedSubject, $plainSafe, $headerBlock, '-f' . WAIVER_DELIVERY_FROM);
        if (!$sent) {
            $sent = @mail($to, $encodedSubject, $plainSafe, $headerBlock);
        }
        return (bool) $sent;
    }
}
