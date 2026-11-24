<?php
/**
 * Skyline 360 Park — franchise inquiry mailer
 * New applications are emailed to every address in FRANCHISE_TEAM.
 * The applicant also receives a confirmation copy.
 */
declare(strict_types=1);

ini_set('display_errors', '0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

const FRANCHISE_FROM = 'franchise@skyline360park.com';
const FRANCHISE_FROM_NAME = 'SKYLINE360PARK';
const RATE_SECONDS = 45;
const FRANCHISE_CAPTCHA_SECRET = 'skyline-360-franchise-captcha-v2';
const CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Every inbox listed here receives the branded inquiry email.
 * Add more addresses on their own line. Use real mailboxes or cPanel forwarders.
 * Visible To: is always franchise@… Extra addresses are BCC’d (hidden from each other
 * and never included in the applicant confirmation).
 */
const FRANCHISE_TEAM = [
    'franchise@skyline360park.com',
    // 'owner@skyline360park.com',
    // 'partners@skyline360park.com',
    // 'youremail@gmail.com',
];

function wants_json(): bool
{
    $accept = strtolower((string) ($_SERVER['HTTP_ACCEPT'] ?? ''));
    $xhr = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) === 'xmlhttprequest';
    $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''));
    return $xhr
        || str_contains($accept, 'application/json')
        || str_contains($contentType, 'application/json');
}

function respond(bool $ok, string $message, int $code = 200): void
{
    http_response_code($code);
    if (wants_json()) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok, 'message' => $message], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $target = $ok ? 'franchise.html?sent=1#apply' : 'franchise.html?error=1#apply';
    header('Location: ' . $target, true, 303);
    exit;
}

function clean_line(string $value, int $max = 200): string
{
    $value = trim(str_replace(["\r", "\n", "\0"], ' ', $value));
    $value = preg_replace('/\s+/', ' ', $value) ?? $value;
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $max);
    }
    return substr($value, 0, $max);
}

function clean_text(string $value, int $max = 4000): string
{
    $value = str_replace("\0", '', $value);
    $value = str_replace(["\r\n", "\r"], "\n", $value);
    $value = trim($value);
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $max);
    }
    return substr($value, 0, $max);
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function encode_header(string $value): string
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

function mailbox_header(string $name, string $email): string
{
    $valid = filter_var($email, FILTER_VALIDATE_EMAIL);
    $email = $valid ?: FRANCHISE_FROM;
    $name = trim(str_replace(['"', "\r", "\n", '<', '>'], '', $name));
    if ($name === '') {
        return $email;
    }
    return '"' . encode_header($name) . '" <' . $email . '>';
}

function site_base_url(): string
{
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? 'www.skyline360park.com'));
    $host = preg_replace('/:\d+$/', '', $host) ?: 'www.skyline360park.com';
    if ($host === 'localhost' || str_starts_with($host, '127.') || str_contains($host, '::1')) {
        $host = 'www.skyline360park.com';
    }
    return 'https://' . $host;
}

function logo_file_path(): string
{
    return __DIR__ . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'logo-sm.png';
}

function logo_bytes(): ?string
{
    $path = logo_file_path();
    if (!is_readable($path)) {
        return null;
    }
    $data = file_get_contents($path);
    return $data === false || $data === '' ? null : $data;
}

/**
 * Unique, validated franchise team inboxes from FRANCHISE_TEAM.
 *
 * @return list<string>
 */
function franchise_team_addresses(): array
{
    $valid = [];
    foreach (FRANCHISE_TEAM as $email) {
        $email = strtolower(trim((string) $email));
        if ($email === '' || str_starts_with($email, '//')) {
            continue;
        }
        if (filter_var($email, FILTER_VALIDATE_EMAIL) && !in_array($email, $valid, true)) {
            $valid[] = $email;
        }
    }
    return $valid ?: [FRANCHISE_FROM];
}

/**
 * Public To: address for team notices (never the applicant).
 * Extra team inboxes are BCC’d so they stay off the visible recipient line.
 */
function franchise_team_to(): string
{
    $list = franchise_team_addresses();
    if (in_array(FRANCHISE_FROM, $list, true)) {
        return FRANCHISE_FROM;
    }
    return $list[0];
}

function franchise_team_bcc(): string
{
    $to = franchise_team_to();
    $bcc = array_values(array_filter(
        franchise_team_addresses(),
        static fn (string $email): bool => $email !== $to
    ));
    return implode(', ', $bcc);
}

function read_payload(): array
{
    $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''));
    if (str_contains($contentType, 'application/json')) {
        $raw = file_get_contents('php://input');
        $decoded = json_decode($raw ?: '', true);
        return is_array($decoded) ? $decoded : [];
    }
    return $_POST;
}

function make_captcha_code(): string
{
    $len = strlen(CAPTCHA_ALPHABET);
    $code = '';
    for ($i = 0; $i < 6; $i++) {
        $code .= CAPTCHA_ALPHABET[random_int(0, $len - 1)];
    }
    return $code;
}

function captcha_token_for(string $code): string
{
    return hash_hmac('sha256', strtoupper($code), FRANCHISE_CAPTCHA_SECRET);
}

function issue_captcha(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
    $code = make_captcha_code();
    $_SESSION['franchise_captcha'] = $code;
    $_SESSION['franchise_captcha_at'] = time();
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    echo json_encode([
        'ok' => true,
        'code' => $code,
        'token' => captcha_token_for($code),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

function verify_captcha(array $data): bool
{
    $answer = strtoupper((string) preg_replace('/[^A-Z0-9]/', '', (string) ($data['captcha'] ?? '')));
    if (strlen($answer) !== 6) {
        return false;
    }

    $issued = (int) ($_SESSION['franchise_captcha_at'] ?? 0);
    $sessionCode = strtoupper((string) ($_SESSION['franchise_captcha'] ?? ''));
    $fresh = $issued > 0 && (time() - $issued) <= 1800;
    if ($fresh && $sessionCode !== '' && hash_equals($sessionCode, $answer)) {
        unset($_SESSION['franchise_captcha'], $_SESSION['franchise_captcha_at']);
        return true;
    }

    $token = (string) ($data['captcha_token'] ?? '');
    $spent = $_SESSION['franchise_captcha_spent'] ?? [];
    if ($token !== '' && empty($spent[$token]) && hash_equals(captcha_token_for($answer), $token)) {
        $_SESSION['franchise_captcha_spent'][$token] = time();
        unset($_SESSION['franchise_captcha'], $_SESSION['franchise_captcha_at']);
        return true;
    }

    return false;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method === 'GET' && isset($_GET['captcha'])) {
    issue_captcha();
}

if ($method !== 'POST') {
    respond(false, 'Please submit the franchise form.', 405);
}

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

$now = time();
$last = (int) ($_SESSION['franchise_last'] ?? 0);
if ($last && ($now - $last) < RATE_SECONDS) {
    respond(false, 'Please wait a moment before sending another application.', 429);
}

$data = read_payload();

// Honeypot — pretend success so bots do not retry.
if (clean_line((string) ($data['website'] ?? ''), 80) !== '') {
    $_SESSION['franchise_last'] = $now;
    respond(true, 'Application sent. We will be in touch shortly.');
}

$startedAt = (int) ($data['started_at'] ?? 0);
if ($startedAt > 0) {
    $elapsed = $now - $startedAt;
    if ($elapsed < 2 || $elapsed > 7200) {
        respond(false, 'Please try sending the form again.', 400);
    }
}

$fields = [
    'first_name' => clean_line((string) ($data['first_name'] ?? ''), 80),
    'last_name' => clean_line((string) ($data['last_name'] ?? ''), 80),
    'address' => clean_line((string) ($data['address'] ?? ''), 160),
    'city' => clean_line((string) ($data['city'] ?? ''), 80),
    'state' => clean_line((string) ($data['state'] ?? ''), 80),
    'zip' => clean_line((string) ($data['zip'] ?? ''), 20),
    'country' => clean_line((string) ($data['country'] ?? ''), 80),
    'phone' => clean_line((string) ($data['phone'] ?? ''), 40),
    'email' => clean_line((string) ($data['email'] ?? ''), 120),
    'timeline' => clean_line((string) ($data['timeline'] ?? ''), 80),
    'age' => clean_line((string) ($data['age'] ?? ''), 80),
    'net_worth' => clean_line((string) ($data['net_worth'] ?? ''), 80),
    'capital' => clean_line((string) ($data['capital'] ?? ''), 80),
    'experience' => clean_line((string) ($data['experience'] ?? ''), 120),
    'units' => clean_line((string) ($data['units'] ?? ''), 80),
    'heard' => clean_line((string) ($data['heard'] ?? ''), 80),
    'contact_pref' => clean_line((string) ($data['contact_pref'] ?? ''), 40),
    'message' => clean_text((string) ($data['message'] ?? ''), 4000),
];
// market_label / market_status / nearest_* / market_notes are page-only guide fields
// and must never appear in team or applicant emails.

$required = ['first_name', 'last_name', 'address', 'city', 'state', 'zip', 'country', 'phone', 'email', 'contact_pref', 'timeline', 'age', 'net_worth', 'capital', 'experience', 'units', 'heard'];
foreach ($required as $key) {
    if ($fields[$key] === '') {
        respond(false, 'Please complete every required field.', 422);
    }
}

if (!filter_var($fields['email'], FILTER_VALIDATE_EMAIL)) {
    respond(false, 'Please enter a valid email address.', 422);
}

if ($fields['age'] !== 'Yes, I am 21 years of age or older') {
    respond(false, 'Franchise opportunities are available to adults 21 years of age and older.', 422);
}

if (!verify_captcha($data)) {
    respond(false, 'Please type the current park code to continue. Refresh the page if you need a new one.', 422);
}

$place = trim($fields['city'] . ', ' . $fields['state'] . ', ' . $fields['country'], ' ,');
$fullName = trim($fields['first_name'] . ' ' . $fields['last_name']);
$submittedAt = gmdate('Y-m-d H:i:s') . ' UTC';
$siteUrl = site_base_url();
$logoCid = 'skyline360park-logo';
$logoData = null;

$labels = [
    'first_name' => 'First name',
    'last_name' => 'Last name',
    'email' => 'Email',
    'phone' => 'Mobile number',
    'contact_pref' => 'Preferred contact',
    'address' => 'Address',
    'city' => 'City',
    'state' => 'State',
    'zip' => 'Zip / postal code',
    'country' => 'Country',
    'timeline' => 'Investment timeline',
    'age' => 'Age requirement',
    'net_worth' => 'Net worth',
    'capital' => 'Liquid capital',
    'experience' => 'Experience',
    'units' => 'Locations of interest',
    'heard' => 'How they heard about Skyline',
    'message' => 'Message',
];

$teamGroups = [
    'Contact' => ['first_name', 'last_name', 'email', 'phone', 'contact_pref'],
    'Market & address' => ['address', 'city', 'state', 'zip', 'country'],
    'Investment snapshot' => ['timeline', 'age', 'net_worth', 'capital', 'experience', 'units', 'heard'],
    'Notes' => ['message'],
];

$applicantGroups = [
    'Your contact details' => ['first_name', 'last_name', 'email', 'phone', 'contact_pref'],
    'Your market' => ['address', 'city', 'state', 'zip', 'country'],
    'Your investment snapshot' => ['timeline', 'age', 'net_worth', 'capital', 'experience', 'units', 'heard'],
    'Your message' => ['message'],
];

$searchBits = array_filter([
    $fullName,
    $fields['email'],
    $fields['phone'],
    $fields['city'],
    $fields['state'],
    $fields['country'],
]);
$searchLine = 'SKYLINE360PARK | ' . implode(' | ', $searchBits);

function field_rows_html(array $keys, array $fields, array $labels): string
{
    $html = '';
    foreach ($keys as $key) {
        $value = trim((string) ($fields[$key] ?? ''));
        if ($value === '') {
            continue;
        }
        $display = nl2br(h($value));
        if ($key === 'email') {
            $display = '<a href="mailto:' . h($value) . '" style="color:#4a1f7a;font-weight:800;text-decoration:none;">' . h($value) . '</a>';
        } elseif ($key === 'phone') {
            $tel = preg_replace('/[^\d+]/', '', $value) ?: $value;
            $display = '<a href="tel:' . h((string) $tel) . '" style="color:#4a1f7a;font-weight:800;text-decoration:none;">' . h($value) . '</a>';
        }
    $html .= "\r\n<tr>\r\n"
            . '<td style="padding:10px 14px;width:38%;vertical-align:top;background:#f7f2fc;color:#5c4a78;font-size:12px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;border-bottom:1px solid #efe8f6;">'
            . h($labels[$key] ?? $key)
            . "</td>\r\n"
            . '<td style="padding:10px 14px;vertical-align:top;color:#14081f;font-size:15px;font-weight:700;border-bottom:1px solid #efe8f6;">'
            . $display
            . "</td>\r\n</tr>\r\n";
    }
    return $html;
}

function sections_html(array $groups, array $fields, array $labels): string
{
    $out = '';
    foreach ($groups as $title => $keys) {
        $rows = field_rows_html($keys, $fields, $labels);
        if ($rows === '') {
            continue;
        }
        $out .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border:1px solid #e4d8f2;border-radius:12px;overflow:hidden;">'
            . '<tr><td style="padding:11px 14px;background:#4a1f7a;color:#ffffff;font-size:13px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">'
            . h($title)
            . '</td></tr>'
            . '<tr><td style="padding:0;background:#ffffff;">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
            . $rows
            . '</table></td></tr></table>';
    }
    return $out;
}

function sections_plain(array $groups, array $fields, array $labels): string
{
    $lines = [];
    foreach ($groups as $title => $keys) {
        $chunk = [];
        foreach ($keys as $key) {
            $value = trim((string) ($fields[$key] ?? ''));
            if ($value === '') {
                continue;
            }
            $chunk[] = ($labels[$key] ?? $key) . ': ' . $value;
        }
        if (!$chunk) {
            continue;
        }
        $lines[] = strtoupper($title);
        $lines[] = str_repeat('-', 28);
        array_push($lines, ...$chunk);
        $lines[] = '';
    }
    return implode("\n", $lines);
}

function brand_wordmark_html(string $siteUrl, string $size = 'lg'): string
{
    $nameSize = $size === 'sm' ? '22px' : '34px';
    $subSize = $size === 'sm' ? '10px' : '11px';
    $pad = $size === 'sm' ? '10px 16px 12px' : '14px 22px 16px';
    $orbit = $size === 'sm' ? '18px' : '26px';
    $orbitFont = $size === 'sm' ? '9px' : '11px';

    return '<a href="' . h($siteUrl) . '" style="display:inline-block;text-decoration:none;color:#ffffff;">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">'
        . '<tr><td align="center" style="padding:' . $pad . ';border:2px solid rgba(255,213,74,0.55);border-radius:16px;background:linear-gradient(180deg,#2a1250 0%,#1b0a32 100%);">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" border="0">'
        . '<tr>'
        . '<td valign="middle" style="padding-right:10px;">'
        . '<span style="display:inline-block;width:' . $orbit . ';height:' . $orbit . ';line-height:' . $orbit . ';border-radius:50%;border:2px solid #2ec4ff;background:#14081f;color:#ffd54a;font-family:Impact,Haettenschweiler,Arial Black,sans-serif;font-size:' . $orbitFont . ';font-weight:800;text-align:center;">360</span>'
        . '</td>'
        . '<td valign="middle" style="text-align:left;">'
        . '<div style="font-family:Impact,Haettenschweiler,Arial Black,Arial,sans-serif;font-size:' . $nameSize . ';line-height:0.95;letter-spacing:0.04em;text-transform:uppercase;color:#ffffff;">'
        . 'SKYLINE <span style="color:#ffd54a;">360</span>'
        . '</div>'
        . '<div style="margin-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:' . $subSize . ';line-height:1;letter-spacing:0.34em;font-weight:800;text-transform:uppercase;color:#2ec4ff;">PARK</div>'
        . '</td>'
        . '</tr>'
        . '</table>'
        . '</td></tr></table>'
        . '</a>';
}

function branded_email_html(
    string $kicker,
    string $headline,
    string $intro,
    string $preheader,
    string $sections,
    string $siteUrl,
    string $footerNote
): string {
    $wordmark = brand_wordmark_html($siteUrl, 'lg');
    $wordmarkSm = brand_wordmark_html($siteUrl, 'sm');

    return '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>SKYLINE360PARK</title>
</head>
<body style="margin:0;padding:0;background:#14081f;color:#14081f;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' . h($preheader) . '</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#14081f;margin:0;padding:0;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
<tr>
  <td align="center" style="background:#1b0a32;padding:26px 20px 20px;">
    ' . $wordmark . '
    <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#cbb8e8;">360&deg; of fun &middot; Franchise</p>
  </td>
</tr>
<tr><td style="height:6px;background:#ff7a00;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr>
  <td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
    <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.18em;font-weight:800;color:#7a4bb8;text-transform:uppercase;">' . h($kicker) . '</p>
    <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#2e1054;">' . h($headline) . '</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#4a3d5c;">' . h($intro) . '</p>
    ' . $sections . '
  </td>
</tr>
<tr>
  <td style="padding:8px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
    <p style="margin:0;font-size:12px;line-height:1.5;color:#7a6d8c;">' . h($footerNote) . '</p>
    <p style="margin:14px 0 0;font-size:12px;"><a href="' . h($siteUrl . '/franchise.html') . '" style="color:#4a1f7a;font-weight:800;text-decoration:none;">skyline360park.com/franchise</a></p>
  </td>
</tr>
<tr>
  <td align="center" style="background:#1b0a32;padding:18px 20px 20px;font-family:Arial,Helvetica,sans-serif;">
    ' . $wordmarkSm . '
    <p style="margin:12px 0 0;font-size:11px;color:#cbb8e8;">franchise@skyline360park.com</p>
  </td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>';
}

function mail_qp(string $value): string
{
    $value = str_replace(["\r\n", "\r"], "\n", $value);
    $encoded = function_exists('quoted_printable_encode')
        ? quoted_printable_encode($value)
        : mail_limit_lines($value, 76);
    return mail_limit_lines($encoded, 76);
}

function mail_limit_lines(string $value, int $max = 900): string
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

function send_branded_mail(
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
    if (!str_contains($to, ',')) {
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return false;
        }
    }

    // Never embed images — keeps MIME small and avoids oversize lines.
    unset($logoData, $logoCid, $embedLogo);

    $boundaryAlt = 'sky_alt_' . bin2hex(random_bytes(8));
    $encodedSubject = encode_header($subject);
    $from = mailbox_header(FRANCHISE_FROM_NAME, FRANCHISE_FROM);
    $reply = mailbox_header($replyName, $replyEmail);

    $plainPart = mail_qp($plain);
    $htmlPart = mail_qp($html);

    $body = "--{$boundaryAlt}\r\n"
        . "Content-Type: text/plain; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
        . $plainPart . "\r\n"
        . "--{$boundaryAlt}\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
        . $htmlPart . "\r\n"
        . "--{$boundaryAlt}--\r\n";

    $body = mail_limit_lines($body, 900);
    $contentType = 'multipart/alternative; boundary="' . $boundaryAlt . '"';

    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: ' . $contentType,
        'From: ' . $from,
        'Sender: ' . $from,
        'Reply-To: ' . $reply,
        'Organization: SKYLINE360PARK',
        'X-Mailer: SKYLINE360PARK-Franchise',
        'X-Entity-Ref-ID: skyline360park-franchise-' . bin2hex(random_bytes(4)),
        'Message-ID: <franchise-' . bin2hex(random_bytes(10)) . '@skyline360park.com>',
        'Date: ' . date('r'),
    ];
    if ($bcc !== '') {
        $headers[] = 'Bcc: ' . $bcc;
    }
    $headerBlock = implode("\r\n", $headers);

    $sent = @mail($to, $encodedSubject, $body, $headerBlock, '-f' . FRANCHISE_FROM);
    if (!$sent) {
        $sent = @mail($to, $encodedSubject, $body, $headerBlock);
    }
    return (bool) $sent;
}

/**
 * Confirmation to the applicant — light MIME, no waits.
 * One branded attempt, then an immediate plain-text fallback.
 */
function send_applicant_confirmation(
    string $to,
    string $subject,
    string $html,
    string $plain
): bool {
    $to = trim($to);
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return false;
    }

    if (send_branded_mail(
        $to,
        $subject,
        $html,
        $plain,
        FRANCHISE_FROM_NAME,
        FRANCHISE_FROM,
        null,
        'skyline360park-logo',
        false
    )) {
        return true;
    }

    $encodedSubject = encode_header($subject);
    $from = mailbox_header(FRANCHISE_FROM_NAME, FRANCHISE_FROM);
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'From: ' . $from,
        'Reply-To: ' . $from,
        'Organization: SKYLINE360PARK',
        'X-Mailer: SKYLINE360PARK-Franchise',
        'Message-ID: <franchise-plain-' . bin2hex(random_bytes(8)) . '@skyline360park.com>',
        'Date: ' . date('r'),
    ];
    $headerBlock = implode("\r\n", $headers);
    $plainSafe = mail_limit_lines($plain, 900);
    $sent = @mail($to, $encodedSubject, $plainSafe, $headerBlock, '-f' . FRANCHISE_FROM);
    if (!$sent) {
        $sent = @mail($to, $encodedSubject, $plainSafe, $headerBlock);
    }
    return (bool) $sent;
}

/**
 * Flush the HTTP success response so the browser can show “sent”
 * while PHP is finishing. Safe on cPanel (PHP-FPM / LiteSpeed).
 */
function flush_success_response(string $message): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    if (wants_json()) {
        $payload = json_encode(['ok' => true, 'message' => $message], JSON_UNESCAPED_UNICODE);
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        header('Connection: close');
        header('Content-Length: ' . strlen($payload));
        echo $payload;
    } else {
        header('Location: franchise.html?sent=1#apply', true, 303);
        header('Connection: close');
    }

    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        return;
    }
    if (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
        return;
    }
    while (ob_get_level() > 0) {
        @ob_end_flush();
    }
    @flush();
}

$teamSubject = 'SKYLINE360PARK Franchise | ' . $fullName . ' | ' . $fields['email'] . ' | ' . $place;
$applicantSubject = 'SKYLINE360PARK | Franchise inquiry received | ' . $fullName;

$teamHtml = branded_email_html(
    'New franchise inquiry',
    $fullName,
    'A new Skyline 360 Park franchise inquiry just arrived. Below are only the details the applicant entered on the form.',
    $searchLine . ' | new franchise inquiry',
    sections_html($teamGroups, $fields, $labels)
        . '<p style="margin:0;font-size:12px;color:#7a6d8c;">Submitted ' . h($submittedAt) . '</p>',
    $siteUrl,
    'Reply to this email to write ' . $fullName . ' directly. This is an inquiry, not a franchise offer.'
);

$applicantHtml = branded_email_html(
    'We received your inquiry',
    'Thanks, ' . $fields['first_name'] . '.',
    'SKYLINE360PARK has your franchise inquiry. Below is a copy of the details you submitted.',
    'SKYLINE360PARK received your franchise inquiry | ' . $fullName . ' | ' . $place,
    sections_html($applicantGroups, $fields, $labels)
        . '<p style="margin:0;font-size:12px;color:#7a6d8c;">Submitted ' . h($submittedAt) . '</p>',
    $siteUrl,
    'This is a confirmation of your inquiry, not an offer to sell a franchise. Questions? Reply to this email or write franchise@skyline360park.com.'
);

$teamPlain = "SKYLINE360PARK — New franchise inquiry\n\n"
    . sections_plain($teamGroups, $fields, $labels)
    . "Submitted: {$submittedAt}\n"
    . "Reply to {$fullName} at {$fields['email']}\n";

$applicantPlain = "SKYLINE360PARK — We received your franchise inquiry\n\n"
    . "Hi {$fields['first_name']},\n\n"
    . "Thanks — here is a copy of the details you submitted.\n\n"
    . sections_plain($applicantGroups, $fields, $labels)
    . "Submitted: {$submittedAt}\n"
    . "Questions: franchise@skyline360park.com\n";

ignore_user_abort(true);
@set_time_limit(20);

// Fire both messages immediately — no delays. Applicant first (light), then team.
$applicantSent = send_applicant_confirmation(
    $fields['email'],
    $applicantSubject,
    $applicantHtml,
    $applicantPlain
);

$teamTo = franchise_team_to();
$teamBcc = franchise_team_bcc();

$teamSent = send_branded_mail(
    $teamTo,
    $teamSubject,
    $teamHtml,
    $teamPlain,
    $fullName,
    $fields['email'],
    null,
    $logoCid,
    false,
    $teamBcc
);

if (!$teamSent) {
    // One immediate retry for the team inbox only.
    $teamSent = send_branded_mail(
        $teamTo,
        $teamSubject,
        $teamHtml,
        $teamPlain,
        $fullName,
        $fields['email'],
        null,
        $logoCid,
        false,
        $teamBcc
    );
}

if (!$teamSent) {
    respond(false, 'We could not send the email just now. Please email franchise@skyline360park.com directly.', 500);
}

if (!$applicantSent) {
    $applicantSent = send_applicant_confirmation(
        $fields['email'],
        $applicantSubject,
        $applicantHtml,
        $applicantPlain
    );
}

$_SESSION['franchise_last'] = $now;
flush_success_response('Application sent. Confirmation emails are on the way.');

if (!$applicantSent) {
    $failHeaders = 'From: ' . mailbox_header(FRANCHISE_FROM_NAME, FRANCHISE_FROM) . "\r\n"
        . 'Content-Type: text/plain; charset=UTF-8';
    if ($teamBcc !== '') {
        $failHeaders .= "\r\nBcc: " . $teamBcc;
    }
    @mail(
        $teamTo,
        encode_header('SKYLINE360PARK | Applicant confirmation failed | ' . $fullName),
        "The franchise inquiry for {$fullName} ({$fields['email']}) reached the team, but the automatic confirmation email to the applicant could not be sent by the server.\n\nPlease reply to the applicant manually.\n",
        $failHeaders,
        '-f' . FRANCHISE_FROM
    );
}
exit;
