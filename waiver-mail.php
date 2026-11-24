<?php
/**
 * Skyline 360 Park â€” per-location waiver mailer
 * Notifies THAT parkâ€™s inbox only. Guest receives a branded confirmation.
 * On success, client redirects to that park+plan WordPress booking page.
 */
declare(strict_types=1);

ini_set('display_errors', '0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

// PHP 7.4 compatibility (some cPanel accounts are not on PHP 8 yet).
if (!function_exists('str_contains')) {
    function str_contains($haystack, $needle): bool
    {
        return $needle === '' || strpos((string) $haystack, (string) $needle) !== false;
    }
}
if (!function_exists('str_starts_with')) {
    function str_starts_with($haystack, $needle): bool
    {
        $needle = (string) $needle;
        return $needle === '' || strncmp((string) $haystack, $needle, strlen($needle)) === 0;
    }
}

$waiverParksFile = __DIR__ . DIRECTORY_SEPARATOR . 'waiver-parks.php';
if (!is_file($waiverParksFile)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'message' => 'Server is missing waiver-parks.php. Upload it next to waiver-mail.php in public_html.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}
require_once $waiverParksFile;

/** Production: required identity, agreement checkboxes, captcha, drawn signature, and typed legal name. */
const WAIVER_TEST_MODE = false;

/** Agreement boxes stored on the park/guest email record. */
const WAIVER_AGREEMENT_LABELS = [
    'cb_safety' => 'Safety rules',
    'cb_legal_rights' => 'Legal rights waived',
    'cb_authorization' => 'Authorization to sign',
    'cb_personal' => 'Personal responsibility',
    'cb_assumption' => 'Assumption of risk',
    'cb_release' => 'Release of liability',
    'cb_covenant' => 'Covenant not to sue',
    'cb_indemnify' => 'Defense and indemnification',
    'cb_property' => 'Liability for property',
    'cb_photo' => 'Photo / video consent',
    'cb_privacy' => 'Privacy notice',
    'cb_terms' => 'Terms of use',
    'cb_arbitration' => 'Arbitration',
    'cb_equipment' => 'Equipment / attractions',
    'adult_confirm' => 'Age and authority (18+)',
    'agree' => 'Final agreement',
];

/** Known-working domain mailboxes used as From fallbacks if a park mailbox is missing. */
const WAIVER_FROM_FALLBACKS = [
    'delivery@skyline360park.com',
    'info@skyline360park.com',
];

const WAIVER_RATE_SECONDS = 8;
const WAIVER_CAPTCHA_SECRET = 'skyline-360-waiver-captcha-v1';
const CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Drawn pad image â€” keep small so it can show inline in email without killing delivery. */
const WAIVER_SIGNATURE_MAX_BYTES = 55000;
const WAIVER_SIGNATURE_CID = 'skyline-waiver-signature';

function waiver_outbox_dir(): string
{
    $dir = __DIR__ . DIRECTORY_SEPARATOR . 'waiver-outbox';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $deny = $dir . DIRECTORY_SEPARATOR . '.htaccess';
    if (!is_file($deny)) {
        @file_put_contents($deny, "Require all denied\nDeny from all\n");
    }
    $index = $dir . DIRECTORY_SEPARATOR . 'index.html';
    if (!is_file($index)) {
        @file_put_contents($index, '');
    }
    return $dir;
}

/**
 * Queue waiver payload for a second, fast background request so mobile submit
 * never waits on PHP mail().
 */
function waiver_queue_job(array $payload): string
{
    $dir = waiver_outbox_dir();
    if (!is_dir($dir) || !is_writable($dir)) {
        return '';
    }
    try {
        $id = bin2hex(random_bytes(16));
    } catch (Throwable $e) {
        $id = sha1(uniqid('waiver', true));
    }
    $path = $dir . DIRECTORY_SEPARATOR . $id . '.json';
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($json === false || @file_put_contents($path, $json, LOCK_EX) === false) {
        return '';
    }
    return $id;
}

function waiver_job_path(string $jobId): string
{
    $jobId = strtolower(preg_replace('/[^a-f0-9]/', '', $jobId) ?? '');
    if (strlen($jobId) < 16) {
        return '';
    }
    return waiver_outbox_dir() . DIRECTORY_SEPARATOR . $jobId . '.json';
}

function waiver_wants_json(): bool
{
    $accept = strtolower((string) ($_SERVER['HTTP_ACCEPT'] ?? ''));
    $xhr = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) === 'xmlhttprequest';
    $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''));
    return $xhr
        || str_contains($accept, 'application/json')
        || str_contains($contentType, 'application/json');
}

function waiver_respond(bool $ok, string $message, int $code = 200, ?string $redirect = null, array $extra = []): void
{
    http_response_code($code);
    if (waiver_wants_json()) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(array_merge([
            'ok' => $ok,
            'message' => $message,
            'redirect' => $redirect,
        ], $extra), JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($ok && $redirect) {
        header('Location: ' . $redirect, true, 303);
        exit;
    }

    $park = clean_line((string) ($_POST['park_id'] ?? $_GET['park'] ?? ''), 40);
    $plan = clean_line((string) ($_POST['plan_id'] ?? $_GET['plan'] ?? ''), 40);
    $q = http_build_query(array_filter([
        'park' => $park !== '' ? $park : null,
        'plan' => ($plan !== '' && $plan !== 'walkin') ? $plan : null,
        'mode' => ($plan === 'walkin') ? 'walkin' : null,
        'error' => $ok ? null : '1',
    ]));
    header('Location: waiver.html?' . $q . '#sign', true, 303);
    exit;
}

/**
 * Answer the phone/browser immediately, then keep working (send mail) after the response is flushed.
 * This prevents "Submittingâ€¦" from hanging on mobile while PHP mail() runs.
 */
function waiver_flush_json(array $payload, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Connection: close');
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        $json = '{"ok":false,"message":"Server encoding error"}';
    }
    header('Content-Length: ' . (string) strlen($json));
    echo $json;

    if (function_exists('session_write_close')) {
        @session_write_close();
    }
    while (ob_get_level() > 0) {
        @ob_end_flush();
    }
    @flush();
    if (function_exists('fastcgi_finish_request')) {
        @fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        @litespeed_finish_request();
    }
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
    $email = $valid ?: $email;
    $name = trim(str_replace(['"', "\r", "\n", '<', '>'], '', $name));
    if ($name === '') {
        return $email;
    }
    return '"' . encode_header($name) . '" <' . $email . '>';
}

function waiver_smtp_log(string $line): void
{
    $dir = waiver_outbox_dir();
    $file = $dir . DIRECTORY_SEPARATOR . 'smtp-debug.log';
    @file_put_contents($file, date('c') . ' ' . $line . "\n", FILE_APPEND | LOCK_EX);
}

function waiver_smtp_last_error(?string $set = null): string
{
    static $err = '';
    if ($set !== null) {
        $err = $set;
        waiver_smtp_log($set);
    }
    return $err;
}

function waiver_smtp_builtin_accounts(): array
{
    // Fallback if waiver-smtp-config.php is missing / blocked by server rules.
    return [
        'katy@skyline360park.com' => [
            'user' => 'katy@skyline360park.com',
            'pass' => '@_KaTyPark360',
        ],
        'fortworth@skyline360park.com' => [
            'user' => 'fortworth@skyline360park.com',
            'pass' => 'F_ro@Roth-360_park',
        ],
        'pennsylvania@skyline360park.com' => [
            'user' => 'pennsylvania@skyline360park.com',
            'pass' => "@360_pEn'NvaNia",
        ],
    ];
}

function waiver_smtp_config(): array
{
    static $cfg = null;
    if (is_array($cfg)) {
        return $cfg;
    }
    $file = __DIR__ . DIRECTORY_SEPARATOR . 'waiver-smtp-config.php';
    $loaded = null;
    if (is_file($file)) {
        $loaded = include $file;
    }
    if (!is_array($loaded)) {
        $loaded = [];
    }
    $accounts = [];
    if (!empty($loaded['accounts']) && is_array($loaded['accounts'])) {
        $accounts = $loaded['accounts'];
    }
    foreach (waiver_smtp_builtin_accounts() as $key => $row) {
        $hasPass = isset($accounts[$key]['pass']) && trim((string) $accounts[$key]['pass']) !== '';
        if (!$hasPass) {
            $accounts[$key] = $row;
        }
    }
    $cfg = [
        'enabled' => array_key_exists('enabled', $loaded) ? (bool) $loaded['enabled'] : true,
        'host' => (string) ($loaded['host'] ?? 'premium231.web-hosting.com'),
        'port' => (int) ($loaded['port'] ?? 465),
        'encryption' => strtolower((string) ($loaded['encryption'] ?? 'ssl')),
        'timeout' => (int) ($loaded['timeout'] ?? 12),
        'public_site_url' => (string) ($loaded['public_site_url'] ?? 'https://www.skyline360park.com'),
        'accounts' => $accounts,
        'relay' => is_array($loaded['relay'] ?? null) ? $loaded['relay'] : ['enabled' => false],
    ];
    return $cfg;
}

function site_base_url(): string
{
    $cfg = waiver_smtp_config();
    $forced = trim((string) ($cfg['public_site_url'] ?? ''));
    if ($forced !== '') {
        return rtrim($forced, '/');
    }
    return 'https://www.skyline360park.com';
}

function waiver_smtp_account(string $fromEmail): ?array
{
    $cfg = waiver_smtp_config();
    if (empty($cfg['enabled']) || empty($cfg['accounts']) || !is_array($cfg['accounts'])) {
        waiver_smtp_last_error('SMTP disabled or no accounts configured');
        return null;
    }
    $fromEmail = strtolower(trim($fromEmail));
    $accounts = $cfg['accounts'];
    $pick = null;
    if (isset($accounts[$fromEmail]) && is_array($accounts[$fromEmail])) {
        $pick = $accounts[$fromEmail];
    } else {
        foreach ($accounts as $row) {
            if (!is_array($row)) {
                continue;
            }
            if (strtolower(trim((string) ($row['user'] ?? ''))) === $fromEmail) {
                $pick = $row;
                break;
            }
        }
    }
    if (!$pick || trim((string) ($pick['pass'] ?? '')) === '') {
        foreach ($accounts as $row) {
            if (is_array($row) && trim((string) ($row['pass'] ?? '')) !== '' && trim((string) ($row['user'] ?? '')) !== '') {
                $pick = $row;
                break;
            }
        }
    }
    if (!$pick || trim((string) ($pick['pass'] ?? '')) === '' || trim((string) ($pick['user'] ?? '')) === '') {
        waiver_smtp_last_error('No SMTP mailbox password available for ' . $fromEmail);
        return null;
    }
    return [
        'host' => (string) ($cfg['host'] ?? 'premium231.web-hosting.com'),
        'port' => (int) ($cfg['port'] ?? 465),
        'encryption' => strtolower((string) ($cfg['encryption'] ?? 'ssl')),
        'timeout' => (int) ($cfg['timeout'] ?? 12),
        'user' => trim((string) $pick['user']),
        'pass' => (string) $pick['pass'],
    ];
}

function waiver_smtp_ssl_context()
{
    $ssl = [
        'verify_peer' => false,
        'verify_peer_name' => false,
        'allow_self_signed' => true,
    ];
    if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) {
        $method = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
            $method |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
        }
        $ssl['crypto_method'] = $method;
    }
    return stream_context_create(['ssl' => $ssl]);
}

function waiver_smtp_read($fp, int $timeout = 12): string
{
    $data = '';
    stream_set_timeout($fp, $timeout);
    while (!feof($fp)) {
        $line = fgets($fp, 515);
        if ($line === false) {
            break;
        }
        $data .= $line;
        if (isset($line[3]) && $line[3] === ' ') {
            break;
        }
    }
    return $data;
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'waiver-delivery-mail.php';
require_once __DIR__ . DIRECTORY_SEPARATOR . 'waiver-smtp-lib.php';

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
    return hash_hmac('sha256', strtoupper($code), WAIVER_CAPTCHA_SECRET);
}

function waiver_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function issue_captcha(): void
{
    waiver_session_start();
    $code = make_captcha_code();
    $_SESSION['waiver_captcha'] = $code;
    $_SESSION['waiver_captcha_at'] = time();
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, private');
    header('Pragma: no-cache');
    echo json_encode([
        'ok' => true,
        'code' => $code,
        'token' => captcha_token_for($code),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

function verify_captcha(array $data): bool
{
    waiver_session_start();
    $answer = strtoupper((string) preg_replace('/[^A-Z0-9]/', '', (string) ($data['captcha'] ?? '')));
    if (strlen($answer) !== 6) {
        return false;
    }

    $token = strtolower(preg_replace('/[^a-f0-9]/', '', (string) ($data['captcha_token'] ?? '')) ?? '');
    $expected = captcha_token_for($answer);
    if ($token !== '' && hash_equals($expected, $token)) {
        $_SESSION['waiver_captcha_spent'][$token] = time();
        unset($_SESSION['waiver_captcha'], $_SESSION['waiver_captcha_at']);
        return true;
    }

    $issued = (int) ($_SESSION['waiver_captcha_at'] ?? 0);
    $sessionCode = strtoupper((string) ($_SESSION['waiver_captcha'] ?? ''));
    $fresh = $issued > 0 && (time() - $issued) <= 1800;
    if ($fresh && $sessionCode !== '' && hash_equals($sessionCode, $answer)) {
        unset($_SESSION['waiver_captcha'], $_SESSION['waiver_captcha_at']);
        return true;
    }

    return false;
}

function park_notify_list(array $park): array
{
    $valid = [];
    foreach ($park['notify'] as $email) {
        $email = strtolower(trim((string) $email));
        if ($email === '' || str_starts_with($email, '//')) {
            continue;
        }
        if (filter_var($email, FILTER_VALIDATE_EMAIL) && !in_array($email, $valid, true)) {
            $valid[] = $email;
        }
    }
    $from = strtolower(trim((string) ($park['fromEmail'] ?? '')));
    if ($from && filter_var($from, FILTER_VALIDATE_EMAIL) && !in_array($from, $valid, true)) {
        array_unshift($valid, $from);
    }
    return $valid;
}

function park_to_and_bcc(array $park): array
{
    $list = park_notify_list($park);
    $from = strtolower((string) $park['fromEmail']);
    $to = in_array($from, $list, true) ? $from : ($list[0] ?? $from);
    $bcc = array_values(array_filter($list, static fn (string $e): bool => $e !== $to));
    return [$to, implode(', ', $bcc)];
}

function parse_signature_image(string $dataUrl): ?array
{
    $dataUrl = trim($dataUrl);
    if ($dataUrl === '' || !preg_match('#^data:image/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$#', $dataUrl, $m)) {
        return null;
    }
    $subtype = strtolower($m[1]);
    if ($subtype === 'jpg') {
        $subtype = 'jpeg';
    }
    $binary = base64_decode(preg_replace('/\s+/', '', $m[2]), true);
    if ($binary === false || $binary === '') {
        return null;
    }
    $image = [
        'mime' => 'image/' . $subtype,
        'ext' => $subtype === 'jpeg' ? 'jpg' : $subtype,
        'bytes' => $binary,
        'filename' => 'waiver-signature.' . ($subtype === 'jpeg' ? 'jpg' : $subtype),
        'cid' => WAIVER_SIGNATURE_CID,
    ];
    $image = shrink_signature_image($image);
    if (strlen((string) $image['bytes']) > WAIVER_SIGNATURE_MAX_BYTES) {
        return null;
    }
    return $image;
}

/**
 * Recompress with GD when available so the pad can travel inline in mail.
 *
 * @param array{mime:string,ext:string,bytes:string,filename:string,cid:string} $image
 * @return array{mime:string,ext:string,bytes:string,filename:string,cid:string}
 */
function shrink_signature_image(array $image): array
{
    if (!function_exists('imagecreatefromstring') || !function_exists('imagejpeg')) {
        return $image;
    }
    $src = @imagecreatefromstring((string) $image['bytes']);
    if ($src === false) {
        return $image;
    }
    $w = imagesx($src);
    $h = imagesy($src);
    if ($w < 1 || $h < 1) {
        imagedestroy($src);
        return $image;
    }
    $tw = min(360, $w);
    $th = max(1, (int) round($h * ($tw / $w)));
    $dst = imagecreatetruecolor($tw, $th);
    if ($dst === false) {
        imagedestroy($src);
        return $image;
    }
    $white = imagecolorallocate($dst, 255, 255, 255);
    imagefill($dst, 0, 0, $white);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $tw, $th, $w, $h);
    ob_start();
    imagejpeg($dst, null, 52);
    $bytes = ob_get_clean();
    imagedestroy($src);
    imagedestroy($dst);
    if (!is_string($bytes) || $bytes === '') {
        return $image;
    }
    return [
        'mime' => 'image/jpeg',
        'ext' => 'jpg',
        'bytes' => $bytes,
        'filename' => 'waiver-signature.jpg',
        'cid' => WAIVER_SIGNATURE_CID,
    ];
}

function signature_image_html(?array $image, string $typedName = ''): string
{
    $typedName = trim($typedName);
    $typedBlock = $typedName !== ''
        ? '<p style="margin:0 0 12px;font-family:Georgia,\'Times New Roman\',serif;font-size:28px;line-height:1.2;font-style:italic;color:#2e1054;">'
            . h($typedName)
            . '</p>'
            . '<p style="margin:0 0 14px;font-size:12px;color:#7a6d8c;">Typed legal name (electronic signature)</p>'
        : '';

    if ($image && !empty($image['bytes'])) {
        $cid = preg_replace('/[^A-Za-z0-9._@-]/', '', (string) ($image['cid'] ?? WAIVER_SIGNATURE_CID)) ?: WAIVER_SIGNATURE_CID;
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border:1px solid #e4d8f2;border-radius:12px;overflow:hidden;">'
            . '<tr><td style="padding:11px 14px;background:#4a1f7a;color:#ffffff;font-size:13px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">Electronic signature</td></tr>'
            . '<tr><td style="padding:14px;background:#ffffff;text-align:center;">'
            . $typedBlock
            . '<img src="cid:' . h($cid) . '" alt="Drawn signature of ' . h($typedName !== '' ? $typedName : 'guest') . '" width="360" style="max-width:100%;height:auto;border:1px solid #efe8f6;border-radius:8px;background:#ffffff;" />'
            . '<p style="margin:10px 0 0;font-size:12px;color:#7a6d8c;">Drawn on the waiver pad'
            . ($typedName !== '' ? ' by <strong>' . h($typedName) . '</strong>' : '')
            . '. If the image is hidden, open the attached <strong>'
            . h((string) ($image['filename'] ?? 'waiver-signature.jpg'))
            . '</strong>.</p>'
            . '</td></tr></table>';
    }

    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border:1px solid #e4d8f2;border-radius:12px;overflow:hidden;">'
        . '<tr><td style="padding:11px 14px;background:#4a1f7a;color:#ffffff;font-size:13px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">Electronic signature</td></tr>'
        . '<tr><td style="padding:14px;background:#ffffff;text-align:center;">'
        . ($typedBlock !== ''
            ? $typedBlock
            : '<p style="margin:0;font-size:14px;color:#14081f;font-weight:700;">Guest confirmed with their typed legal name on the waiver form (see Signature field).</p>')
        . '</td></tr></table>';
}

/**
 * @return list<string>
 */
function waiver_from_candidates(string $parkFromEmail): array
{
    $out = [];
    foreach (array_merge([strtolower(trim($parkFromEmail))], WAIVER_FROM_FALLBACKS) as $email) {
        $email = strtolower(trim($email));
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) && !in_array($email, $out, true)) {
            $out[] = $email;
        }
    }
    return $out;
}

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
        } elseif ($key === 'phone' || $key === 'emergency_phone') {
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
    string $footerNote,
    string $footerEmail
): string {
    $wordmark = brand_wordmark_html($siteUrl, 'lg');
    $wordmarkSm = brand_wordmark_html($siteUrl, 'sm');

    return '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>SKYLINE360PARK Waiver</title>
</head>
<body style="margin:0;padding:0;background:#14081f;color:#14081f;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' . h($preheader) . '</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#14081f;margin:0;padding:0;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
<tr>
  <td align="center" style="background:#1b0a32;padding:26px 20px 20px;">
    ' . $wordmark . '
    <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#cbb8e8;">360&deg; of fun &middot; Waiver</p>
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
  </td>
</tr>
<tr>
  <td align="center" style="background:#1b0a32;padding:18px 20px 20px;font-family:Arial,Helvetica,sans-serif;">
    ' . $wordmarkSm . '
    <p style="margin:12px 0 0;font-size:11px;color:#cbb8e8;">' . h($footerEmail) . '</p>
  </td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>';
}

/**
 * Customer confirmation: short notice + a copy of the details they submitted.
 */
function guest_thankyou_html_simple(
    string $guestName,
    string $parkName,
    string $planLabel,
    string $fromEmail,
    string $fromName,
    string $detailsHtml = ''
): string {
    unset($planLabel);
    $first = trim($guestName);
    if (str_contains($first, ' ')) {
        $first = trim(explode(' ', $first)[0]);
    }
    $hello = $first !== '' ? 'Hi ' . h($first) . ',' : 'Hello,';
    $brand = trim($fromName) !== '' ? $fromName : 'Skyline 360 Park';

    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Waiver received</title></head>'
        . '<body style="margin:0;padding:20px;background:#ffffff;color:#222222;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;">'
        . '<p style="margin:0 0 14px;">' . $hello . '</p>'
        . '<p style="margin:0 0 14px;">We have received your waiver for <strong>' . h($parkName) . '</strong>.</p>'
        . '<p style="margin:0 0 18px;">We will get back to you shortly. A copy of the details you submitted is below.</p>'
        . $detailsHtml
        . '<p style="margin:18px 0 0;">' . h($brand) . '<br>'
        . '<a href="mailto:' . h($fromEmail) . '" style="color:#2e1054;">' . h($fromEmail) . '</a></p>'
        . '</body></html>';
}

/**
 * Customer confirmation: short notice + a copy of the details they submitted.
 */
function guest_confirmation_plain(
    string $guestName,
    string $parkName,
    string $planLabel,
    string $fromEmail,
    string $fromName,
    string $detailsPlain = ''
): string {
    unset($planLabel);
    $first = trim($guestName);
    if (str_contains($first, ' ')) {
        $first = trim(explode(' ', $first)[0]);
    }
    $hello = $first !== '' ? "Hi {$first}," : 'Hello,';
    $brand = trim($fromName) !== '' ? $fromName : 'Skyline 360 Park';
    $details = trim($detailsPlain) !== '' ? "\n" . trim($detailsPlain) . "\n" : '';

    return $hello . "\n\n"
        . "We have received your waiver for {$parkName}.\n"
        . "We will get back to you shortly. A copy of the details you submitted is below.\n"
        . $details
        . "\n{$brand}\n"
        . "{$fromEmail}\n";
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
    string $fromName,
    string $envelopeFrom,
    string $replyName,
    string $replyEmail,
    string $bcc = '',
    ?array $inlineImage = null
): bool {
    $to = trim($to);
    $envelopeFrom = strtolower(trim($envelopeFrom));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    if (!filter_var($envelopeFrom, FILTER_VALIDATE_EMAIL)) {
        return false;
    }

    $boundaryAlt = 'sky_alt_' . bin2hex(random_bytes(8));
    $boundaryRel = 'sky_rel_' . bin2hex(random_bytes(8));
    $encodedSubject = encode_header($subject);
    $from = mailbox_header($fromName, $envelopeFrom);
    $reply = mailbox_header($replyName, $replyEmail);

    $altPart = "--{$boundaryAlt}\r\n"
        . "Content-Type: text/plain; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
        . mail_qp($plain) . "\r\n"
        . "--{$boundaryAlt}\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: quoted-printable\r\n\r\n"
        . mail_qp($html) . "\r\n"
        . "--{$boundaryAlt}--\r\n";

    if ($inlineImage && !empty($inlineImage['bytes']) && !empty($inlineImage['cid'])) {
        $filename = preg_replace('/[^A-Za-z0-9._-]/', '', (string) ($inlineImage['filename'] ?? 'waiver-signature.jpg')) ?: 'waiver-signature.jpg';
        $mime = (string) ($inlineImage['mime'] ?? 'image/jpeg');
        $cid = preg_replace('/[^A-Za-z0-9._@-]/', '', (string) $inlineImage['cid']) ?: WAIVER_SIGNATURE_CID;
        $b64 = chunk_split(base64_encode((string) $inlineImage['bytes']), 76, "\r\n");
        // multipart/related so the drawn signature shows inside the HTML email.
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

    $body = mail_limit_lines($body, 900);

    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: ' . $contentType,
        'From: ' . $from,
        'Reply-To: ' . $reply,
        'Organization: SKYLINE360PARK',
        'X-Mailer: SKYLINE360PARK-Waiver',
        'Message-ID: <waiver-' . bin2hex(random_bytes(10)) . '@skyline360park.com>',
        'Date: ' . date('r'),
    ];
    if (trim($bcc) !== '') {
        $headers[] = 'Bcc: ' . trim($bcc);
    }
    $headerBlock = implode("\r\n", $headers);

    $extraRcpt = [];
    if (trim($bcc) !== '') {
        foreach (preg_split('/\s*,\s*/', trim($bcc)) ?: [] as $bccEmail) {
            if (filter_var($bccEmail, FILTER_VALIDATE_EMAIL)) {
                $extraRcpt[] = $bccEmail;
            }
        }
    }

    // Authenticated SMTP is required on this host (mail() => Relaying not permitted).
    return waiver_smtp_send_message($to, $encodedSubject, $headerBlock, $body, $envelopeFrom);
}

function send_plain_mail(
    string $to,
    string $subject,
    string $plain,
    string $fromName,
    string $envelopeFrom,
    string $replyEmail = ''
): bool {
    $to = trim($to);
    $envelopeFrom = strtolower(trim($envelopeFrom));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL) || !filter_var($envelopeFrom, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    $encodedSubject = encode_header($subject);
    $from = mailbox_header($fromName, $envelopeFrom);
    $reply = $replyEmail !== '' && filter_var($replyEmail, FILTER_VALIDATE_EMAIL)
        ? mailbox_header($fromName, $replyEmail)
        : $from;
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'From: ' . $from,
        'Reply-To: ' . $reply,
        'Organization: SKYLINE360PARK',
        'X-Mailer: SKYLINE360PARK-Waiver',
        'Message-ID: <waiver-plain-' . bin2hex(random_bytes(8)) . '@skyline360park.com>',
        'Date: ' . date('r'),
    ];
    $headerBlock = implode("\r\n", $headers);
    $body = mail_limit_lines($plain, 900);
    if (waiver_smtp_send_message($to, $encodedSubject, $headerBlock, $body, $envelopeFrom)) {
        return true;
    }
    return false;
}

/**
 * Prefer typed branded HTML first (same reliable pattern as franchise-mail.php).
 * Signature image is optional. Park From first, then franchise/info fallbacks, then plain text.
 */
function send_waiver_mail(
    string $to,
    string $subject,
    string $htmlWithSig,
    string $htmlNoSig,
    string $plain,
    string $fromName,
    string $parkFromEmail,
    string $replyName,
    string $replyEmail,
    string $bcc = '',
    ?array $inlineImage = null
): bool {
    unset($htmlWithSig, $fromName, $replyName, $replyEmail, $bcc, $inlineImage);
    $result = waiver_force_send($to, $subject, $plain, $htmlNoSig, $parkFromEmail);
    return !empty($result['ok']);
}
function waiver_deliver_job(string $jobId, string $stage = 'all', bool $fastPark = false): bool
{
    $path = waiver_job_path($jobId);
    if ($path === '') {
        return false;
    }
    $sending = $path . '.sending';
    $lockPath = $path . '.lock';
    $parkMark = $path . '.park';
    $guestMark = $path . '.guest';

    $lock = @fopen($lockPath, 'c');
    if ($lock === false || !@flock($lock, LOCK_EX | LOCK_NB)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        return false;
    }

    // Claim the job atomically so a second request cannot send the park copy twice.
    if (is_file($path)) {
        if (!@rename($path, $sending)) {
            @flock($lock, LOCK_UN);
            fclose($lock);
            return false;
        }
    } elseif (is_file($sending)) {
        $age = time() - (int) @filemtime($sending);
        if ($age < 180) {
            @flock($lock, LOCK_UN);
            fclose($lock);
            return false;
        }
    } else {
        @flock($lock, LOCK_UN);
        fclose($lock);
        @unlink($lockPath);
        return false;
    }

    $unlock = static function () use ($lock, $lockPath): void {
        if (is_resource($lock)) {
            @flock($lock, LOCK_UN);
            fclose($lock);
        }
        @unlink($lockPath);
    };

    $raw = @file_get_contents($sending);
    $job = json_decode((string) $raw, true);
    if (!is_array($job)) {
        @unlink($sending);
        $unlock();
        return false;
    }
    $created = (int) ($job['created'] ?? 0);
    if ($created > 0 && (time() - $created) > 7200) {
        @unlink($sending);
        $unlock();
        return false;
    }

    $parkId = strtolower(clean_line((string) ($job['park_id'] ?? ''), 40));
    $planId = strtolower(clean_line((string) ($job['plan_id'] ?? ''), 40));
    $park = waiver_resolve_park($parkId);
    $plan = $park ? waiver_resolve_plan($park, $planId) : null;
    if (!$park || !$plan) {
        @unlink($sending);
        $unlock();
        return false;
    }

    $fields = is_array($job['fields'] ?? null) ? $job['fields'] : [];
    foreach ($fields as $k => $v) {
        if (!is_string($v)) {
            $fields[$k] = is_scalar($v) ? (string) $v : '';
        }
    }

    $needGuest = ($stage !== 'park');
    $needPark = ($stage !== 'guest');

    $signatureData = trim((string) ($job['signature_data'] ?? ''));
    $signatureImage = $needPark ? parse_signature_image($signatureData) : null;

    $fullName = trim(($fields['first_name'] ?? '') . ' ' . ($fields['last_name'] ?? ''));
    $submittedAt = clean_line((string) ($job['submitted_at'] ?? (gmdate('Y-m-d H:i:s') . ' UTC')), 40);
    $siteUrl = site_base_url();
    $fromEmail = (string) $park['fromEmail'];
    $fromName = (string) $park['fromName'];
    [$parkTo, $parkBcc] = park_to_and_bcc($park);

    $labels = [
        'park_name' => 'Park location',
        'plan_name' => 'Plan',
        'mode' => 'Signed for',
        'fill_method' => 'Details filled via',
        'first_name' => 'First name',
        'last_name' => 'Last name',
        'email' => 'Email',
        'phone' => 'Mobile number',
        'country_code' => 'Country code',
        'country_iso' => 'Country',
        'dob' => 'Date of birth',
        'address' => 'Address',
        'city' => 'City',
        'state' => 'State',
        'zip' => 'Zip / postal code',
        'emergency_name' => 'Emergency contact',
        'emergency_phone' => 'Emergency phone',
        'participants' => 'Minors / participants',
        'signature' => 'Electronic signature',
    ];
    foreach (WAIVER_AGREEMENT_LABELS as $key => $label) {
        $labels[$key] = $label;
    }

    if (($fields['mode'] ?? '') === 'minors') {
        $fields['mode'] = 'Me and minor(s)';
    } else {
        $fields['mode'] = 'Just me';
    }

    if (($fields['fill_method'] ?? '') === 'scan') {
        $fields['fill_method'] = 'ID scan (autofill)';
    } elseif (($fields['fill_method'] ?? '') === 'document') {
        $fields['fill_method'] = 'Printed document scan (autofill)';
    } else {
        $fields['fill_method'] = 'Manual entry';
    }

    $parkAddress = trim((string) ($park['address'] ?? ''));
    if ($parkAddress !== '') {
        $fields['park_address'] = $parkAddress;
        $labels['park_address'] = 'Park address';
    }

    $agreementKeys = array_keys(WAIVER_AGREEMENT_LABELS);
    $parkGroups = [
        'Visit' => ['park_name', 'plan_name', 'park_address', 'mode', 'fill_method'],
        'Guest' => ['first_name', 'last_name', 'email', 'phone', 'country_code', 'country_iso', 'dob'],
        'Address' => ['address', 'city', 'state', 'zip'],
        'Emergency' => ['emergency_name', 'emergency_phone'],
        'Participants' => ['participants'],
        'Agreement' => $agreementKeys,
        'Signature' => ['signature'],
    ];
    $guestGroups = [
        'Your visit' => ['park_name', 'plan_name', 'park_address', 'mode', 'fill_method'],
        'Your details' => ['first_name', 'last_name', 'email', 'phone', 'country_code', 'country_iso', 'dob'],
        'Your address' => ['address', 'city', 'state', 'zip'],
        'Emergency contact' => ['emergency_name', 'emergency_phone'],
        'Participants' => ['participants'],
        'Agreement accepted' => $agreementKeys,
        'Your signature' => ['signature'],
    ];

    $guestEmail = strtolower(trim((string) ($fields['email'] ?? '')));
    if (!filter_var($guestEmail, FILTER_VALIDATE_EMAIL)) {
        @unlink($sending);
        waiver_smtp_last_error('Guest email missing or invalid');
        $unlock();
        return false;
    }

    $guestEmailBanner = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border:2px solid #ff7a00;border-radius:12px;overflow:hidden;">'
        . '<tr><td style="padding:14px 16px;background:#fff7ef;font-family:Arial,Helvetica,sans-serif;">'
        . '<p style="margin:0 0 4px;font-size:11px;letter-spacing:0.14em;font-weight:800;text-transform:uppercase;color:#a85a00;">Guest email (sender)</p>'
        . '<p style="margin:0;font-size:18px;line-height:1.3;font-weight:800;color:#2e1054;">'
        . '<a href="mailto:' . h($guestEmail) . '" style="color:#2e1054;text-decoration:none;">' . h($guestEmail) . '</a>'
        . '</p>'
        . '<p style="margin:8px 0 0;font-size:13px;color:#5c4a78;">Reply to this email to contact <strong>' . h($fullName) . '</strong> directly.</p>'
        . '</td></tr></table>';

    $signatureBlockText = signature_image_html(null, $fullName);
    $guestSubject = 'Skyline 360 Park | Waiver received | ' . $park['shortName'] . ' | ' . $fullName;
    $parkSubject = 'Waiver received | ' . $park['shortName'] . ' | ' . $fullName;
    $guestPlain = '';
    $guestHtml = '';
    $guestHtmlSimple = '';
    $parkPlain = '';
    $parkHtml = '';
    $parkHtmlNoImg = '';
    $parkSig = null;

    if ($needGuest) {
        $guestDetailsHtml = sections_html($guestGroups, $fields, $labels)
            . signature_image_html(null, $fullName);
        $guestDetailsPlain = sections_plain($guestGroups, $fields, $labels)
            . 'Electronic signature (typed): ' . ($fields['signature'] ?? '') . "\n";

        $guestPlain = guest_confirmation_plain(
            (string) ($fields['first_name'] ?? $fullName),
            (string) $park['name'],
            (string) $plan['label'],
            $fromEmail,
            $fromName,
            $guestDetailsPlain
        );
        $guestHtml = branded_email_html(
            'We received your waiver',
            'Thanks, ' . trim((string) ($fields['first_name'] ?? $fullName)) . '.',
            'SKYLINE360PARK has your waiver for ' . $park['name'] . ' (' . $plan['label'] . '). Below is a copy of the details you submitted.',
            'SKYLINE360PARK received your waiver | ' . $fullName . ' | ' . $park['shortName'],
            $guestDetailsHtml
                . '<p style="margin:0;font-size:12px;color:#7a6d8c;">Submitted ' . h($submittedAt) . '</p>',
            $siteUrl,
            'This confirms we received your waiver. Questions? Write ' . $fromEmail . ' or reply to this email.',
            $fromEmail
        );
        $guestHtmlSimple = guest_thankyou_html_simple(
            (string) ($fields['first_name'] ?? $fullName),
            (string) $park['name'],
            (string) $plan['label'],
            $fromEmail,
            $fromName,
            $guestDetailsHtml
        );
    }

    if ($needPark) {
        $sigPlainNote = 'Electronic signature (typed): ' . ($fields['signature'] ?? '') . "\n"
            . ($signatureImage ? "Drawn signature: included as an inline image in the HTML email.\n" : '');

        $parkPlain = "Signed waiver notice\n\n"
            . "Guest email: {$guestEmail}\n"
            . "Guest name: {$fullName}\n"
            . "Reply to: {$guestEmail}\n\n"
            . sections_plain($parkGroups, $fields, $labels)
            . $sigPlainNote
            . "Signed: {$submittedAt}\n";

        if ($signatureImage) {
            $parkSig = $signatureImage;
            $parkSig['cid'] = WAIVER_SIGNATURE_CID . '-park';
        }

        $parkHtml = branded_email_html(
            'New signed waiver',
            $fullName,
            $park['name'] . ' — ' . $plan['label'] . '. Guest email and form details are below. Reply to this message to reach the guest.',
            'SKYLINE360PARK waiver | ' . $park['shortName'] . ' | ' . $plan['label'] . ' | ' . $fullName,
            $guestEmailBanner . sections_html($parkGroups, $fields, $labels)
                . signature_image_html($parkSig, $fullName)
                . '<p style="margin:0;font-size:12px;color:#7a6d8c;">Signed ' . h($submittedAt) . '</p>',
            $siteUrl,
            'Reply to this email to reach ' . $fullName . ' at ' . $guestEmail . '. This is a signed waiver notice for this location only.',
            $fromEmail
        );
        $parkHtmlNoImg = branded_email_html(
            'New signed waiver',
            $fullName,
            $park['name'] . ' — ' . $plan['label'] . '. Guest email and form details are below. Reply to this message to reach the guest.',
            'SKYLINE360PARK waiver | ' . $park['shortName'] . ' | ' . $plan['label'] . ' | ' . $fullName,
            $guestEmailBanner . sections_html($parkGroups, $fields, $labels) . $signatureBlockText
                . '<p style="margin:0;font-size:12px;color:#7a6d8c;">Signed ' . h($submittedAt) . '</p>',
            $siteUrl,
            'Reply to this email to reach ' . $fullName . ' at ' . $guestEmail . '. This is a signed waiver notice for this location only.',
            $fromEmail
        );
    }

    @set_time_limit(60);
    ignore_user_abort(true);

    $guestSent = !empty($job['guest_sent']) || is_file($guestMark);
    $parkSent = !empty($job['park_sent']) || is_file($parkMark);
    $guestResult = ['ok' => $guestSent, 'detail' => $guestSent ? 'already sent' : ''];
    $parkResult = ['ok' => $parkSent, 'detail' => $parkSent ? 'already sent' : ''];

    $sendGuestCopy = static function () use (
        $guestEmail,
        $guestSubject,
        $guestPlain,
        $guestHtml,
        $guestHtmlSimple,
        $fromEmail,
        $fromName
    ): array {
        $result = waiver_force_send_guest(
            $guestEmail,
            $guestSubject,
            $guestPlain,
            $guestHtml,
            $fromEmail,
            $fromEmail,
            $fromName
        );
        if (!empty($result['ok'])) {
            return $result;
        }
        return waiver_force_send_guest(
            $guestEmail,
            $guestSubject,
            $guestPlain,
            $guestHtmlSimple,
            $fromEmail,
            $fromEmail,
            $fromName
        );
    };

    $persistJob = static function () use (&$job, $path, $sending, $unlock): void {
        @file_put_contents($path, json_encode($job, JSON_UNESCAPED_UNICODE), LOCK_EX);
        @unlink($sending);
        $unlock();
    };

    // Guest-only: PHP mail() through waiver-delivery-mail.php (delivery@),
    // same method as franchise-mail.php. Park inbox copy stays on SMTP after flush.
    if ($stage === 'guest') {
        if (!$guestSent) {
            $guestResult = $sendGuestCopy();
            $guestSent = !empty($guestResult['ok']);
            if ($guestSent) {
                @file_put_contents($guestMark, '1', LOCK_EX);
            }
        }
        $job['guest_sent'] = $guestSent;
        $job['park_sent'] = $parkSent;
        $job['guest_email'] = $guestEmail;
        $job['last_detail'] = 'guest=' . ($guestSent ? 'OK' : 'FAIL') . ' (' . ($guestResult['detail'] ?? '') . ')';
        waiver_smtp_last_error($job['last_detail']);
        $persistJob();
        return $guestSent;
    }

    // Park copy first on 'all' so a background retry never delays the location inbox.
    if ($needPark && !$parkSent) {
        $parkResult = waiver_force_send_park(
            $parkTo,
            $parkSubject,
            $parkPlain,
            $parkHtml,
            $fromEmail,
            $guestEmail,
            $fullName,
            $parkSig,
            $fastPark
        );
        if (empty($parkResult['ok'])) {
            $parkResult = waiver_force_send_park(
                $parkTo,
                $parkSubject,
                $parkPlain,
                $parkHtmlNoImg,
                $fromEmail,
                $guestEmail,
                $fullName,
                null,
                $fastPark
            );
        }
        $parkSent = !empty($parkResult['ok']);
        if ($parkSent) {
            $job['park_sent'] = true;
            @file_put_contents($parkMark, '1', LOCK_EX);
        }
    }

    if ($needGuest && !$guestSent) {
        $guestResult = $sendGuestCopy();
        $guestSent = !empty($guestResult['ok']);
        if ($guestSent) {
            @file_put_contents($guestMark, '1', LOCK_EX);
        }
    }

    $guestSent = !empty($guestResult['ok']) || $guestSent || is_file($guestMark);
    $parkSent = !empty($parkResult['ok']) || $parkSent || is_file($parkMark);
    $detail = 'guest=' . ($guestSent ? 'OK' : 'FAIL') . ' (' . ($guestResult['detail'] ?? '') . '); '
        . 'park=' . ($parkSent ? 'OK' : 'FAIL') . ' (' . ($parkResult['detail'] ?? '') . ')';
    waiver_smtp_last_error($detail);
    $job['last_detail'] = $detail;
    $job['guest_sent'] = $guestSent;
    $job['park_sent'] = $parkSent;
    $job['guest_email'] = $guestEmail;

    if ($stage === 'park') {
        $persistJob();
        return $parkSent;
    }

    if ($guestSent && $parkSent) {
        @unlink($sending);
        @unlink($parkMark);
        @unlink($guestMark);
        $unlock();
        return true;
    }

    @file_put_contents($path, json_encode($job, JSON_UNESCAPED_UNICODE), LOCK_EX);
    @unlink($sending);
    $unlock();
    return false;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

// Health check — open: waiver-mail.php?ping=1
if ($method === 'GET' && isset($_GET['ping'])) {
    $cfg = waiver_smtp_config();
    $acct = waiver_smtp_account('katy@skyline360park.com');
    $relay = waiver_smtp_relay_account();
    waiver_respond(true, 'waiver-mail.php is online', 200, null, [
        'php' => PHP_VERSION,
        'openssl' => extension_loaded('openssl'),
        'parks' => is_file(__DIR__ . DIRECTORY_SEPARATOR . 'waiver-parks.php'),
        'outbox_writable' => is_dir(waiver_outbox_dir()) && is_writable(waiver_outbox_dir()),
        'smtp_config_file' => is_file(__DIR__ . DIRECTORY_SEPARATOR . 'waiver-smtp-config.php'),
        'smtp_enabled' => !empty($cfg['enabled']),
        'smtp_account_ready' => $acct !== null,
        'smtp_user' => $acct['user'] ?? '',
        'guest_relay_ready' => $relay !== null,
        'guest_relay_host' => $relay['host'] ?? '',
        'last_smtp_error' => waiver_smtp_last_error(),
    ]);
}

// Live SMTP test — open: waiver-mail.php?smtp_test=1&to=you@gmail.com
if ($method === 'GET' && isset($_GET['smtp_test'])) {
    $to = clean_line((string) ($_GET['to'] ?? ''), 120);
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        waiver_respond(false, 'Add &to=your@email.com', 422);
    }
    $from = 'katy@skyline360park.com';
    $body = "Skyline 360 Park mail test\nTime: " . gmdate('c') . "\nTo: {$to}\n";
    $html = '<p>' . h($body) . '</p>';
    $toDomain = strtolower((string) substr(strrchr($to, '@') ?: '', 1));
    $external = $toDomain !== '' && $toDomain !== 'skyline360park.com';
    $result = $external
        ? waiver_force_send_guest($to, 'SKYLINE360PARK guest mail test', $body, $html, $from, $from, 'Skyline 360 Park')
        : waiver_force_send($to, 'SKYLINE360PARK SMTP test', $body, $html, $from);
    $ok = !empty($result['ok']);
    waiver_respond($ok, $ok ? 'Test accepted by server. Check inbox/spam.' : 'Mail test failed.', $ok ? 200 : 500, null, [
        'to' => $to,
        'path' => $external ? 'guest_relay' : 'park_smtp',
        'relay_ready' => waiver_smtp_relay_account() !== null,
        'detail' => $result['detail'] ?? waiver_smtp_last_error(),
        'openssl' => extension_loaded('openssl'),
    ]);
}

if ($method === 'GET' && isset($_GET['captcha'])) {
    issue_captcha();
}

// Background email delivery (fired by the phone after Accept succeeds).
$deliverId = clean_line((string) ($_GET['deliver'] ?? $_POST['deliver_job'] ?? ''), 64);
if ($deliverId !== '') {
    ignore_user_abort(true);
    @set_time_limit(60);
    $sent = waiver_deliver_job($deliverId);
    waiver_respond(
        $sent,
        $sent ? 'Waiver emails sent to guest and park.' : 'Waiver email delivery failed or still retrying.',
        $sent ? 200 : 502,
        null,
        [
            'job' => $deliverId,
            'detail' => waiver_smtp_last_error(),
        ]
    );
}

if ($method !== 'POST') {
    waiver_respond(false, 'Please submit the waiver form.', 405);
}

if (session_status() !== PHP_SESSION_ACTIVE) {
    waiver_session_start();
}

$now = time();
$last = (int) ($_SESSION['waiver_last'] ?? 0);
if (!WAIVER_TEST_MODE && $last && ($now - $last) < WAIVER_RATE_SECONDS) {
    waiver_respond(false, 'Please wait a moment before sending another waiver.', 429);
}

$data = read_payload();

// Empty $_POST usually means the request exceeded post_max_size (common with signatures on phones).
$contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($contentLength > 0 && $data === []) {
    waiver_respond(
        false,
        'Your submission was too large for this server. Clear the signature pad, redraw a smaller signature, and try again.',
        413
    );
}

if (clean_line((string) ($data['website'] ?? ''), 80) !== '') {
    $_SESSION['waiver_last'] = $now;
    waiver_respond(true, 'Waiver received.', 200, site_base_url() . '/location.html');
}

$startedAt = (int) ($data['started_at'] ?? 0);
if (!WAIVER_TEST_MODE && $startedAt > 0) {
    $elapsed = $now - $startedAt;
    if ($elapsed < 2 || $elapsed > 7200) {
        waiver_respond(false, 'Please try signing the waiver again.', 400);
    }
}

$parkId = strtolower(clean_line((string) ($data['park_id'] ?? ''), 40));
$planId = strtolower(clean_line((string) ($data['plan_id'] ?? ''), 40));
$park = waiver_resolve_park($parkId);
if (!$park) {
    waiver_respond(false, 'Choose a valid park location before signing.', 422);
}
$plan = waiver_resolve_plan($park, $planId);
if (!$plan) {
    waiver_respond(false, 'Choose a valid plan for this location.', 422);
}
// Walk-in / navbar: park waiver with no locked plan — empty registry redirect is OK.
if ($planId !== 'walkin' && $plan['redirect'] === '') {
    waiver_respond(false, 'Choose a valid plan for this location.', 422);
}

$fields = [
    'park_name' => clean_line((string) $park['name'], 120),
    'plan_name' => clean_line((string) $plan['label'], 80),
    'mode' => clean_line((string) ($data['mode'] ?? 'self'), 20),
    'fill_method' => clean_line((string) ($data['fill_method'] ?? 'manual'), 20),
    'first_name' => clean_line((string) ($data['first_name'] ?? ''), 80),
    'last_name' => clean_line((string) ($data['last_name'] ?? ''), 80),
    'email' => clean_line((string) ($data['email'] ?? ''), 120),
    'phone' => clean_line((string) ($data['phone'] ?? ''), 40),
    'country_code' => clean_line((string) ($data['country_code'] ?? ''), 12),
    'country_iso' => clean_line((string) ($data['country_iso'] ?? ''), 8),
    'dob' => clean_line((string) ($data['dob'] ?? ''), 40),
    'address' => clean_line((string) ($data['address'] ?? ($data['address_search'] ?? '')), 160),
    'city' => clean_line((string) ($data['city'] ?? ''), 80),
    'state' => clean_line((string) ($data['state'] ?? ''), 80),
    'zip' => clean_line((string) ($data['zip'] ?? ''), 20),
    'emergency_name' => clean_line((string) ($data['emergency_name'] ?? ''), 120),
    'emergency_phone' => clean_line((string) ($data['emergency_phone'] ?? ''), 40),
    'participants' => clean_text((string) ($data['participants'] ?? ''), 2000),
    'signature' => clean_line((string) ($data['signature'] ?? ''), 160),
];

// Only allow known fill paths on the park/guest record.
if (($fields['fill_method'] ?? '') === 'scan' || ($fields['fill_method'] ?? '') === 'document') {
    // keep
} else {
    $fields['fill_method'] = 'manual';
}
foreach (WAIVER_AGREEMENT_LABELS as $check => $_label) {
    $fields[$check] = clean_line((string) ($data[$check] ?? ''), 10) === 'yes' ? 'Accepted' : '';
}

$minorsRaw = (string) ($data['minors_json'] ?? '[]');
$minorsDecoded = json_decode($minorsRaw, true);
$minorsLines = [];
$minorsIncomplete = false;
if (is_array($minorsDecoded)) {
    foreach ($minorsDecoded as $minor) {
        if (!is_array($minor)) {
            continue;
        }
        $mf = clean_line((string) ($minor['first_name'] ?? ''), 80);
        $ml = clean_line((string) ($minor['last_name'] ?? ''), 80);
        $md = clean_line((string) ($minor['dob'] ?? ''), 40);
        if ($mf === '' && $ml === '' && $md === '') {
            continue;
        }
        if ($mf === '' || $ml === '' || $md === '') {
            $minorsIncomplete = true;
            continue;
        }
        $minorsLines[] = trim($mf . ' ' . $ml . " (DOB {$md})");
    }
}
if ($minorsLines && $fields['participants'] === '') {
    $fields['participants'] = implode("\n", $minorsLines);
}

$requiredChecks = array_keys(WAIVER_AGREEMENT_LABELS);
if (!WAIVER_TEST_MODE) {
    foreach ($requiredChecks as $check) {
        if (clean_line((string) ($data[$check] ?? ''), 10) !== 'yes') {
            waiver_respond(false, 'Please tick every box in the Participant indemnification, waiver, general release, and assumption of risk agreement before accepting.', 422);
        }
    }
}

$signatureDataCheck = trim((string) ($data['signature_data'] ?? ''));
// Light check only on Accept â€” heavy image decode/mail happens in deliver_job.
$hasSigData = $signatureDataCheck !== '' && str_starts_with($signatureDataCheck, 'data:image/');
    if (!WAIVER_TEST_MODE && !$hasSigData) {
    waiver_respond(false, 'Please draw your signature on the pad and type your full legal name before accepting.', 422);
}

$required = [
    'first_name', 'last_name', 'email', 'phone', 'dob',
    'address', 'city', 'state', 'zip',
    'emergency_name', 'emergency_phone', 'signature',
];
if (!WAIVER_TEST_MODE) {
    foreach ($required as $key) {
        if ($fields[$key] === '') {
            waiver_respond(false, 'Please complete every required field.', 422);
        }
    }

    if (!filter_var($fields['email'], FILTER_VALIDATE_EMAIL)) {
        waiver_respond(false, 'Please enter a valid email address.', 422);
    }

    if ($fields['mode'] === 'minors' && (!$minorsLines || $minorsIncomplete)) {
        waiver_respond(false, 'Please add at least one minor with first name, last name, and date of birth, or choose Just me.', 422);
    }

    $expectedSig = strtolower(trim($fields['first_name'] . ' ' . $fields['last_name']));
    $givenSig = strtolower(trim($fields['signature']));
    if ($expectedSig === '' || $givenSig !== $expectedSig) {
        waiver_respond(false, 'Type your full legal name exactly as first and last name for your signature.', 422);
    }

    if (!verify_captcha($data)) {
        waiver_respond(false, 'Please type the current park code to continue. Refresh for a new one.', 422);
    }
} else {
    // Soft defaults for optional fields only — NEVER invent/replace the guest email.
    if ($fields['first_name'] === '') {
        $fields['first_name'] = 'Test';
    }
    if ($fields['last_name'] === '') {
        $fields['last_name'] = 'Guest';
    }
    if ($fields['signature'] === '') {
        $fields['signature'] = trim($fields['first_name'] . ' ' . $fields['last_name']);
    }
    if ($fields['phone'] === '') {
        $fields['phone'] = '0000000000';
    }
    if ($fields['dob'] === '') {
        $fields['dob'] = '2000-01-01';
    }
    if ($fields['address'] === '') {
        $fields['address'] = 'Test address';
    }
    if ($fields['city'] === '') {
        $fields['city'] = 'Test City';
    }
    if ($fields['state'] === '') {
        $fields['state'] = 'TX';
    }
    if ($fields['zip'] === '') {
        $fields['zip'] = '00000';
    }
    if ($fields['emergency_name'] === '') {
        $fields['emergency_name'] = 'N/A';
    }
    if ($fields['emergency_phone'] === '') {
        $fields['emergency_phone'] = '0000000000';
    }
}

// Guest email is always required — confirmation copy and park Reply-To depend on it.
if ($fields['email'] === '' || !filter_var($fields['email'], FILTER_VALIDATE_EMAIL)) {
    waiver_respond(false, 'Please enter a valid guest email address so we can send your confirmation copy.', 422);
}
$fields['email'] = strtolower($fields['email']);

$fullName = trim($fields['first_name'] . ' ' . $fields['last_name']);
$submittedAt = gmdate('Y-m-d H:i:s') . ' UTC';
[$parkTo] = park_to_and_bcc($park);

$_SESSION['waiver_last'] = $now;
if (function_exists('session_write_close')) {
    @session_write_close();
}

$redirect = (string) ($plan['redirect'] ?? '');
if ($planId === 'walkin') {
    $redirect = 'location.html?id=' . rawurlencode($parkId) . '&from=walkin#plans';
    $message = 'Waiver signed. Opening this park’s plans…';
} else {
    $message = 'Waiver signed. Opening your booking page…';
}

$jobPayload = [
    'created' => $now,
    'submitted_at' => $submittedAt,
    'park_id' => $parkId,
    'plan_id' => $planId,
    'fields' => $fields,
    'signature_data' => !empty($hasSigData) ? substr($signatureDataCheck, 0, 120000) : '',
];

$jobId = waiver_queue_job($jobPayload);
if ($jobId === '') {
    try {
        $jobId = bin2hex(random_bytes(16));
    } catch (Throwable $e) {
        $jobId = sha1(uniqid('waiver', true));
    }
    $tmpPath = waiver_outbox_dir() . DIRECTORY_SEPARATOR . $jobId . '.json';
    if (@file_put_contents($tmpPath, json_encode($jobPayload, JSON_UNESCAPED_UNICODE), LOCK_EX) === false) {
        waiver_respond(false, 'Could not queue waiver for email delivery. Check waiver-outbox folder permissions.', 500);
    }
}

ignore_user_abort(true);
@set_time_limit(90);

$okPayload = [
    'ok' => true,
    'message' => $message,
    'redirect' => $redirect,
    'job' => $jobId,
    'park' => $parkId,
    'plan' => $planId,
    'park_id' => $parkId,
    'plan_id' => $planId,
    'park_inbox' => $parkTo,
    'guest_email' => $fields['email'],
    'mail_sent' => false,
    'mail_queued' => true,
];

// Customer copy first through delivery@ (waiver-delivery-mail.php), then the form can close.
// Park notice still goes out after flush on the existing SMTP path.
waiver_deliver_job($jobId, 'guest');

if (waiver_wants_json()) {
    waiver_flush_json($okPayload, 200);
} else {
    header('Location: ' . $redirect, true, 303);
    header('Connection: close');
    if (function_exists('session_write_close')) {
        @session_write_close();
    }
    while (ob_get_level() > 0) {
        @ob_end_flush();
    }
    @flush();
    if (function_exists('fastcgi_finish_request')) {
        @fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        @litespeed_finish_request();
    }
}

waiver_deliver_job($jobId, 'park');
waiver_deliver_job($jobId, 'guest');
exit;
