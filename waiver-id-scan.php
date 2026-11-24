<?php
/**
 * Skyline 360 Park — waiver ID scan (AWS Textract AnalyzeID)
 * Accepts a front ID image (back optional for legacy clients), returns structured guest fields only.
 * Images are never written to disk permanently.
 */
declare(strict_types=1);

ini_set('display_errors', '0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Content-Type: application/json; charset=utf-8');

// PHP 7.4 compatibility (some cPanel accounts are not on PHP 8 yet).
if (!function_exists('str_starts_with')) {
    function str_starts_with($haystack, $needle): bool
    {
        $needle = (string) $needle;
        return $needle === '' || strncmp((string) $haystack, $needle, strlen($needle)) === 0;
    }
}
if (!function_exists('mb_substr')) {
    function mb_substr($string, $start, $length = null)
    {
        return $length === null
            ? substr((string) $string, (int) $start)
            : substr((string) $string, (int) $start, (int) $length);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'POST required.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$configFile = __DIR__ . DIRECTORY_SEPARATOR . 'waiver-id-scan-config.php';
if (!is_file($configFile)) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'message' => 'Server is missing waiver-id-scan-config.php. Upload it next to waiver-id-scan.php.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/** @var array $cfg */
$cfg = require $configFile;
if (!is_array($cfg) || empty($cfg['enabled'])) {
    http_response_code(503);
    echo json_encode([
        'ok' => false,
        'message' => 'ID scan is temporarily unavailable. Please fill the form manually.',
        'fallback' => 'manual',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$accessKey = trim((string) ($cfg['access_key'] ?? ''));
$secretKey = trim((string) ($cfg['secret_key'] ?? ''));
$region = trim((string) ($cfg['region'] ?? 'us-east-1')) ?: 'us-east-1';
$maxBytes = (int) ($cfg['max_image_bytes'] ?? 4500000);
$rateSeconds = max(3, (int) ($cfg['rate_seconds'] ?? 8));

if ($accessKey === '' || $secretKey === '') {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'message' => 'ID scan is not configured. Please fill the form manually.',
        'fallback' => 'manual',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

function waiver_id_scan_client_ip(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return preg_replace('/[^0-9a-fA-F:.]/', '', (string) $ip) ?: '0.0.0.0';
}

function waiver_id_scan_rate_dir(): string
{
    $dir = __DIR__ . DIRECTORY_SEPARATOR . 'waiver-outbox' . DIRECTORY_SEPARATOR . 'id-scan-rate';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return $dir;
}

function waiver_id_scan_rate_ok(int $seconds): bool
{
    $dir = waiver_id_scan_rate_dir();
    if (!is_dir($dir) || !is_writable($dir)) {
        return true;
    }
    $ip = waiver_id_scan_client_ip();
    $file = $dir . DIRECTORY_SEPARATOR . hash('sha256', $ip) . '.ts';
    $now = time();
    if (is_file($file)) {
        $prev = (int) @file_get_contents($file);
        if ($prev > 0 && ($now - $prev) < $seconds) {
            return false;
        }
    }
    @file_put_contents($file, (string) $now, LOCK_EX);
    return true;
}

/**
 * @return array{bytes:string,mime:string}|null
 */
function waiver_id_scan_decode_image(string $dataUrl, int $maxBytes): ?array
{
    $dataUrl = trim($dataUrl);
    if ($dataUrl === '' || strlen($dataUrl) > ($maxBytes * 2 + 128)) {
        return null;
    }
    if (!preg_match('#^data:(image/(jpeg|jpg|png|webp));base64,#i', $dataUrl, $m)) {
        return null;
    }
    $mime = strtolower($m[1]);
    if ($mime === 'image/jpg') {
        $mime = 'image/jpeg';
    }
    $b64 = substr($dataUrl, strlen($m[0]));
    $raw = base64_decode($b64, true);
    if ($raw === false || $raw === '' || strlen($raw) > $maxBytes) {
        return null;
    }
    // Basic magic-byte check
    $head = substr($raw, 0, 12);
    $ok = str_starts_with($head, "\xFF\xD8\xFF")
        || str_starts_with($head, "\x89PNG\r\n\x1a\n")
        || str_starts_with($head, 'RIFF');
    if (!$ok) {
        return null;
    }
    return ['bytes' => $raw, 'mime' => $mime];
}

/**
 * Re-encode image bytes as JPEG (optionally rotated). Returns null if GD unavailable.
 *
 * @param int $clockwiseTurns 0–3 (each turn = 90° clockwise)
 */
function waiver_id_scan_as_jpeg(string $bytes, int $clockwiseTurns = 0): ?string
{
    if (!function_exists('imagecreatefromstring') || !function_exists('imagejpeg')) {
        return null;
    }
    $img = @imagecreatefromstring($bytes);
    if ($img === false) {
        return null;
    }
    $turns = $clockwiseTurns % 4;
    if ($turns < 0) {
        $turns += 4;
    }
    if ($turns === 1 && function_exists('imagerotate')) {
        $rotated = imagerotate($img, -90, 0);
        imagedestroy($img);
        if ($rotated === false) {
            return null;
        }
        $img = $rotated;
    } elseif ($turns === 2 && function_exists('imagerotate')) {
        $rotated = imagerotate($img, 180, 0);
        imagedestroy($img);
        if ($rotated === false) {
            return null;
        }
        $img = $rotated;
    } elseif ($turns === 3 && function_exists('imagerotate')) {
        $rotated = imagerotate($img, 90, 0);
        imagedestroy($img);
        if ($rotated === false) {
            return null;
        }
        $img = $rotated;
    }

    // Mild clarity boost for soft phone photos (helps Textract on washed / slightly blurry IDs)
    if (function_exists('imagefilter')) {
        @imagefilter($img, IMG_FILTER_CONTRAST, -18);
        @imagefilter($img, IMG_FILTER_BRIGHTNESS, 4);
        // Negative smooth approximates a light sharpen
        @imagefilter($img, IMG_FILTER_SMOOTH, -7);
    }

    ob_start();
    $ok = imagejpeg($img, null, 90);
    imagedestroy($img);
    $out = ob_get_clean();
    if (!$ok || !is_string($out) || $out === '') {
        return null;
    }
    return $out;
}

/**
 * Original + 90° / 180° / 270° variants when GD is available.
 *
 * @return list<string>
 */
function waiver_id_scan_orientation_variants(string $bytes): array
{
    $out = [$bytes];
    foreach ([1, 2, 3] as $turns) {
        $rotated = waiver_id_scan_as_jpeg($bytes, $turns);
        if (is_string($rotated) && $rotated !== '') {
            $out[] = $rotated;
        }
    }
    return $out;
}

/**
 * Deduplicate image byte blobs (client + server rotations often overlap).
 *
 * @param list<string> $pages
 * @return list<string>
 */
function waiver_id_scan_unique_pages(array $pages, int $limit = 6): array
{
    $seen = [];
    $out = [];
    foreach ($pages as $bytes) {
        if (!is_string($bytes) || $bytes === '') {
            continue;
        }
        $key = md5(substr($bytes, 0, 4096) . (string) strlen($bytes));
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $out[] = $bytes;
        if (count($out) >= $limit) {
            break;
        }
    }
    return $out;
}

/**
 * Score how complete a mapped field pack is (higher = better).
 */
function waiver_id_scan_score_mapped(array $mapped): int
{
    $f = is_array($mapped['fields'] ?? null) ? $mapped['fields'] : [];
    $score = 0;
    if (trim((string) ($f['first_name'] ?? '')) !== '') {
        $score += 4;
    }
    if (trim((string) ($f['last_name'] ?? '')) !== '') {
        $score += 4;
    }
    if (trim((string) ($f['dob'] ?? '')) !== '') {
        $score += 3;
    }
    if (trim((string) ($f['address'] ?? '')) !== '') {
        $score += 2;
    }
    if (trim((string) ($f['city'] ?? '')) !== '') {
        $score += 1;
    }
    if (trim((string) ($f['state'] ?? '')) !== '') {
        $score += 1;
    }
    if (trim((string) ($f['zip'] ?? '')) !== '') {
        $score += 1;
    }
    if (trim((string) ($f['phone'] ?? '')) !== '') {
        $score += 2;
    }
    return $score;
}

/**
 * True when mapped result is too weak to autofill.
 */
function waiver_id_scan_mapped_weak(array $mapped): bool
{
    return ($mapped['filled_count'] ?? 0) < 2 || empty($mapped['has_name']);
}

/**
 * Decode a list of data-URL images from the client.
 *
 * @param mixed $raw
 * @return list<string>
 */
function waiver_id_scan_decode_variant_list($raw, int $maxBytes, int $limit = 4): array
{
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $item) {
        if (!is_string($item) || $item === '') {
            continue;
        }
        $decoded = waiver_id_scan_decode_image($item, $maxBytes);
        if ($decoded === null) {
            continue;
        }
        $out[] = $decoded['bytes'];
        if (count($out) >= $limit) {
            break;
        }
    }
    return $out;
}

function waiver_id_scan_aws_sign(
    string $method,
    string $host,
    string $uri,
    string $payload,
    string $region,
    string $service,
    string $accessKey,
    string $secretKey,
    string $amzTarget
): array {
    $now = gmdate('Ymd\THis\Z');
    $date = gmdate('Ymd');
    $payloadHash = hash('sha256', $payload);
    $canonicalHeaders =
        "content-type:application/x-amz-json-1.1\n" .
        "host:{$host}\n" .
        "x-amz-date:{$now}\n" .
        "x-amz-target:{$amzTarget}\n";
    $signedHeaders = 'content-type;host;x-amz-date;x-amz-target';
    $canonicalRequest = implode("\n", [
        $method,
        $uri,
        '',
        $canonicalHeaders,
        $signedHeaders,
        $payloadHash,
    ]);
    $credentialScope = "{$date}/{$region}/{$service}/aws4_request";
    $stringToSign = implode("\n", [
        'AWS4-HMAC-SHA256',
        $now,
        $credentialScope,
        hash('sha256', $canonicalRequest),
    ]);
    $kDate = hash_hmac('sha256', $date, 'AWS4' . $secretKey, true);
    $kRegion = hash_hmac('sha256', $region, $kDate, true);
    $kService = hash_hmac('sha256', $service, $kRegion, true);
    $kSigning = hash_hmac('sha256', 'aws4_request', $kService, true);
    $signature = hash_hmac('sha256', $stringToSign, $kSigning);
    $authorization =
        "AWS4-HMAC-SHA256 Credential={$accessKey}/{$credentialScope}, " .
        "SignedHeaders={$signedHeaders}, Signature={$signature}";

    return [
        'Authorization' => $authorization,
        'Content-Type' => 'application/x-amz-json-1.1',
        'Host' => $host,
        'X-Amz-Date' => $now,
        'X-Amz-Target' => $amzTarget,
    ];
}

/**
 * Map AWS Textract error JSON into a guest-safe message.
 *
 * @param array<string, mixed> $json
 * @return array{ok:false,message:string,fallback:string,code?:string,http?:int}
 */
function waiver_id_scan_aws_error_result(array $json, int $status, string $genericMsg): array
{
    $type = (string) ($json['__type'] ?? '');
    $raw = (string) ($json['Message'] ?? $json['message'] ?? '');
    $hay = $type . ' ' . $raw;

    if (
        stripos($hay, 'SubscriptionRequired') !== false
        || stripos($hay, 'needs a subscription') !== false
    ) {
        return [
            'ok' => false,
            'code' => 'aws_subscription',
            'message' =>
                'Amazon Textract is not enabled on this AWS account yet. In AWS Console, open Amazon Textract (region us-east-1), accept any “get started / subscribe” prompts, confirm billing is active, then try again. Until then, please fill the form manually.',
            'fallback' => 'manual',
            'http' => $status,
        ];
    }
    if (stripos($hay, 'UnrecognizedClient') !== false || stripos($hay, 'InvalidClientTokenId') !== false || stripos($hay, 'security token') !== false) {
        return [
            'ok' => false,
            'code' => 'aws_credentials',
            'message' =>
                'ID scan AWS credentials are invalid or inactive. Update waiver-id-scan-config.php with a working access key, or fill manually.',
            'fallback' => 'manual',
            'http' => $status,
        ];
    }
    if (stripos($hay, 'AccessDenied') !== false || stripos($hay, 'not authorized') !== false) {
        return [
            'ok' => false,
            'code' => 'aws_access',
            'message' =>
                'This AWS user is not allowed to use Textract. Attach AmazonTextractFullAccess (or equivalent), then try again — or fill manually.',
            'fallback' => 'manual',
            'http' => $status,
        ];
    }
    if (stripos($hay, 'throttl') !== false || stripos($hay, 'ProvisionedThroughput') !== false) {
        return [
            'ok' => false,
            'code' => 'aws_throttle',
            'message' => 'Too many scan attempts. Please wait a moment and try again.',
            'fallback' => 'manual',
            'http' => $status,
        ];
    }
    if (stripos($hay, 'InvalidParameter') !== false || stripos($hay, 'UnsupportedDocument') !== false) {
        return [
            'ok' => false,
            'code' => 'bad_image',
            'message' => $genericMsg,
            'fallback' => 'manual',
            'http' => $status,
        ];
    }

    return [
        'ok' => false,
        'code' => 'aws_error',
        'message' => $genericMsg,
        'fallback' => 'manual',
        'http' => $status,
        'aws_type' => $type !== '' ? $type : null,
    ];
}

/**
 * @param array<int, string> $imageBytesList
 */
function waiver_id_scan_analyze_id(
    array $imageBytesList,
    string $region,
    string $accessKey,
    string $secretKey
): array {
    $pages = [];
    foreach ($imageBytesList as $bytes) {
        $pages[] = ['Bytes' => base64_encode($bytes)];
    }
    $payload = json_encode(['DocumentPages' => $pages], JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        return ['ok' => false, 'message' => 'Could not prepare ID images.'];
    }

    $host = "textract.{$region}.amazonaws.com";
    $uri = '/';
    $target = 'Textract.AnalyzeID';
    $headers = waiver_id_scan_aws_sign(
        'POST',
        $host,
        $uri,
        $payload,
        $region,
        'textract',
        $accessKey,
        $secretKey,
        $target
    );

    $headerLines = [];
    foreach ($headers as $k => $v) {
        $headerLines[] = "{$k}: {$v}";
    }

    $url = "https://{$host}{$uri}";
    if (!function_exists('curl_init')) {
        return [
            'ok' => false,
            'message' => 'ID scan is unavailable on this server (cURL missing). Please fill manually.',
            'fallback' => 'manual',
        ];
    }
    $ch = curl_init($url);
    if ($ch === false) {
        return ['ok' => false, 'message' => 'Server cannot reach ID scan service.'];
    }
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => $headerLines,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_CONNECTTIMEOUT => 12,
    ]);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($errno !== 0 || !is_string($body) || $body === '') {
        return [
            'ok' => false,
            'message' => 'Could not reach ID scan service. Please try again or fill manually.',
            'fallback' => 'manual',
        ];
    }

    $json = json_decode($body, true);
    if (!is_array($json)) {
        return [
            'ok' => false,
            'message' => 'Unexpected response from ID scan service.',
            'fallback' => 'manual',
        ];
    }

    if ($status >= 400) {
        return waiver_id_scan_aws_error_result(
            $json,
            $status,
            'We could not read that ID clearly. Please retake photos or fill manually.'
        );
    }

    return ['ok' => true, 'data' => $json];
}

/**
 * @param array<string, mixed> $textract
 * @return array<string, mixed>
 */
function waiver_id_scan_map_fields(array $textract): array
{
    $fields = [];
    $docs = $textract['IdentityDocuments'] ?? [];
    if (!is_array($docs)) {
        $docs = [];
    }
    foreach ($docs as $doc) {
        $list = $doc['IdentityDocumentFields'] ?? [];
        if (!is_array($list)) {
            continue;
        }
        foreach ($list as $item) {
            if (!is_array($item)) {
                continue;
            }
            $typeRaw = $item['Type'] ?? '';
            $type = is_array($typeRaw)
                ? (string) ($typeRaw['Text'] ?? '')
                : (string) $typeRaw;
            $valueDet = is_array($item['ValueDetection'] ?? null) ? $item['ValueDetection'] : [];
            $value = trim((string) ($valueDet['Text'] ?? ''));
            $normalized = '';
            if (isset($valueDet['NormalizedValue']) && is_array($valueDet['NormalizedValue'])) {
                $normalized = trim((string) ($valueDet['NormalizedValue']['Value'] ?? ''));
            }
            // Prefer AWS normalized date/value when present (more reliable for DOB).
            if ($normalized !== '') {
                $value = $normalized;
            }
            $conf = (float) ($valueDet['Confidence'] ?? 0);
            if ($type === '' || $value === '') {
                continue;
            }
            // Prefer higher confidence if both sides return the same key
            if (!isset($fields[$type]) || $conf >= (float) ($fields[$type]['confidence'] ?? 0)) {
                $fields[$type] = ['value' => $value, 'confidence' => $conf];
            }
        }
    }

    $get = static function (string $key) use ($fields): string {
        return trim((string) ($fields[$key]['value'] ?? ''));
    };

    $first = waiver_id_scan_title_case($get('FIRST_NAME'));
    $last = waiver_id_scan_title_case($get('LAST_NAME'));

    $dobRaw = $get('DATE_OF_BIRTH');
    $dob = waiver_id_scan_parse_date($dobRaw);

    // Keep raw address for parsing (state codes); title-case street/city after split.
    $address = $get('ADDRESS');
    $city = $get('CITY_IN_ADDRESS');
    $state = $get('STATE_IN_ADDRESS');
    if ($state === '') {
        $state = $get('STATE_NAME');
    }
    $zip = $get('ZIP_CODE_IN_ADDRESS');

    // Sometimes ADDRESS is a multi-line block: street\ncity state zip
    if ($address !== '' && ($city === '' || $state === '' || $zip === '')) {
        $parsed = waiver_id_scan_split_address_block($address);
        if ($city === '' && $parsed['city'] !== '') {
            $city = $parsed['city'];
        }
        if ($state === '' && $parsed['state'] !== '') {
            $state = $parsed['state'];
        }
        if ($zip === '' && $parsed['zip'] !== '') {
            $zip = $parsed['zip'];
        }
        if ($parsed['street'] !== '') {
            $address = $parsed['street'];
        }
    }

    $address = waiver_id_scan_title_case($address);
    $city = waiver_id_scan_title_case($city);
    if (strlen($state) === 2) {
        $state = strtoupper($state);
    } else {
        $state = waiver_id_scan_title_case($state);
    }

    return waiver_id_scan_pack_mapped($first, $last, $dob, $address, $city, $state, $zip);
}

/**
 * Soften ALL-CAPS license text for form fields without harming abbreviations.
 */
function waiver_id_scan_title_case(string $value): string
{
    $value = trim($value);
    if ($value === '') {
        return '';
    }
    // Only rewrite when the whole string is uppercase letters/spaces/punct
    if (!preg_match('/[a-z]/', $value) && preg_match('/[A-Z]/', $value)) {
        if (function_exists('mb_convert_case')) {
            return mb_convert_case(mb_strtolower($value), MB_CASE_TITLE, 'UTF-8');
        }
        return ucwords(strtolower($value));
    }
    return $value;
}

/**
 * @return array{iso:string,month:string,day:string,year:string}
 */
function waiver_id_scan_parse_date(string $raw, bool $preferDayFirst = false): array
{
    $empty = ['iso' => '', 'month' => '', 'day' => '', 'year' => ''];
    $raw = trim($raw);
    if ($raw === '') {
        return $empty;
    }
    // Common DL formats: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, MMDDYYYY
    if (preg_match('/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/', $raw, $m)) {
        $a = (int) $m[1];
        $b = (int) $m[2];
        $year = (int) $m[3];
        if ($a > 12 && $b <= 12) {
            // Definitely DD/MM/YYYY
            $day = $a;
            $month = $b;
        } elseif ($b > 12 && $a <= 12) {
            // Definitely MM/DD/YYYY
            $month = $a;
            $day = $b;
        } elseif ($preferDayFirst) {
            // Ambiguous — prefer DD/MM (common outside the US, e.g. Nigerian licences)
            $day = $a;
            $month = $b;
        } else {
            $month = $a;
            $day = $b;
        }
    } elseif (preg_match('/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/', $raw, $m)) {
        $year = (int) $m[1];
        $month = (int) $m[2];
        $day = (int) $m[3];
    } elseif (preg_match('/^(\d{2})(\d{2})(\d{4})$/', $raw, $m)) {
        if ($preferDayFirst) {
            $day = (int) $m[1];
            $month = (int) $m[2];
        } else {
            $month = (int) $m[1];
            $day = (int) $m[2];
        }
        $year = (int) $m[3];
        if ($month > 12 && $day <= 12) {
            $tmp = $month;
            $month = $day;
            $day = $tmp;
        }
    } else {
        $ts = strtotime($raw);
        if ($ts === false) {
            return $empty;
        }
        $year = (int) date('Y', $ts);
        $month = (int) date('n', $ts);
        $day = (int) date('j', $ts);
    }

    if ($year < 1900 || $year > ((int) date('Y')) || $month < 1 || $month > 12 || $day < 1 || $day > 31) {
        return $empty;
    }
    if (!checkdate($month, $day, $year)) {
        return $empty;
    }

    return [
        'iso' => sprintf('%04d-%02d-%02d', $year, $month, $day),
        'month' => sprintf('%02d', $month),
        'day' => sprintf('%02d', $day),
        'year' => (string) $year,
    ];
}

/**
 * @return array{street:string,city:string,state:string,zip:string}
 */
function waiver_id_scan_split_address_block(string $block): array
{
    $out = ['street' => '', 'city' => '', 'state' => '', 'zip' => ''];
    $lines = preg_split('/\r\n|\r|\n|,/', $block) ?: [];
    $lines = array_values(array_filter(array_map('trim', $lines), static fn ($l) => $l !== ''));
    if (!$lines) {
        return $out;
    }
    $out['street'] = $lines[0];
    $tail = $lines[count($lines) - 1];
    if (count($lines) >= 2 && preg_match('/^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i', $tail, $m)) {
        $out['city'] = trim($m[1]);
        $out['state'] = strtoupper(trim($m[2]));
        $out['zip'] = trim($m[3]);
        if (count($lines) > 2) {
            $out['street'] = implode(', ', array_slice($lines, 0, -1));
        }
    } elseif (preg_match('/^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i', $block, $m)) {
        $out['street'] = trim($m[1]);
        $out['state'] = strtoupper(trim($m[2]));
        $out['zip'] = trim($m[3]);
    }
    return $out;
}

/**
 * Call Textract AnalyzeDocument with Queries (typed/printed pages).
 *
 * @param array<int, string> $imageBytesList
 */
function waiver_id_scan_analyze_document(
    array $imageBytesList,
    string $region,
    string $accessKey,
    string $secretKey
): array {
    // Queries work on one document page per call; use the clearest first page,
    // then optionally merge a second page via DetectDocumentText fallback text.
    $primary = $imageBytesList[0] ?? '';
    if ($primary === '') {
        return ['ok' => false, 'message' => 'Please add a clear photo of your typed document.'];
    }

    $queries = [
        ['Text' => 'What is the person\'s first name or given name?', 'Alias' => 'FIRST_NAME'],
        ['Text' => 'What is the person\'s last name or surname or family name?', 'Alias' => 'LAST_NAME'],
        ['Text' => 'What is the full name of the person as printed on the ID or licence?', 'Alias' => 'FULL_NAME'],
        ['Text' => 'What is the date of birth or DOB?', 'Alias' => 'DATE_OF_BIRTH'],
        ['Text' => 'What is the phone number or mobile number?', 'Alias' => 'PHONE'],
        ['Text' => 'What is the residential street address?', 'Alias' => 'ADDRESS'],
        ['Text' => 'What is the city or town?', 'Alias' => 'CITY'],
        ['Text' => 'What is the state, province, or FCT?', 'Alias' => 'STATE'],
        ['Text' => 'What is the ZIP code or postal code?', 'Alias' => 'ZIP'],
    ];

    $payloadArr = [
        'Document' => ['Bytes' => base64_encode($primary)],
        'FeatureTypes' => ['QUERIES'],
        'QueriesConfig' => ['Queries' => $queries],
    ];
    $payload = json_encode($payloadArr, JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        return ['ok' => false, 'message' => 'Could not prepare document image.'];
    }

    $host = "textract.{$region}.amazonaws.com";
    $target = 'Textract.AnalyzeDocument';
    $headers = waiver_id_scan_aws_sign(
        'POST',
        $host,
        '/',
        $payload,
        $region,
        'textract',
        $accessKey,
        $secretKey,
        $target
    );
    $headerLines = [];
    foreach ($headers as $k => $v) {
        $headerLines[] = "{$k}: {$v}";
    }

    if (!function_exists('curl_init')) {
        return [
            'ok' => false,
            'message' => 'Document scan is unavailable on this server (cURL missing). Please fill manually.',
            'fallback' => 'manual',
        ];
    }
    $ch = curl_init("https://{$host}/");
    if ($ch === false) {
        return ['ok' => false, 'message' => 'Server cannot reach document scan service.'];
    }
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => $headerLines,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_CONNECTTIMEOUT => 12,
    ]);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($errno !== 0 || !is_string($body) || $body === '') {
        return [
            'ok' => false,
            'message' => 'Could not reach document scan service. Please try again or fill manually.',
            'fallback' => 'manual',
        ];
    }
    $json = json_decode($body, true);
    if (!is_array($json)) {
        return [
            'ok' => false,
            'message' => 'Unexpected response from document scan service.',
            'fallback' => 'manual',
        ];
    }
    if ($status >= 400) {
        $awsErr = waiver_id_scan_aws_error_result(
            $json,
            $status,
            'We could not read that document. Use a clearer typed/printed page or fill manually.'
        );
        if (in_array(($awsErr['code'] ?? ''), ['aws_subscription', 'aws_credentials', 'aws_access'], true)) {
            return $awsErr;
        }
        // Fall back to plain text OCR on the page(s)
        return waiver_id_scan_detect_text_pages($imageBytesList, $region, $accessKey, $secretKey);
    }

    $mapped = waiver_id_scan_map_query_result($json);

    // If queries were weak, enrich with DetectDocumentText heuristics across pages
    if (($mapped['filled_count'] ?? 0) < 2) {
        $textResult = waiver_id_scan_detect_text_pages($imageBytesList, $region, $accessKey, $secretKey);
        if (!empty($textResult['ok']) && !empty($textResult['mapped'])) {
            $mapped = waiver_id_scan_merge_mapped($mapped, $textResult['mapped']);
        }
    } elseif (count($imageBytesList) > 1) {
        $textResult = waiver_id_scan_detect_text_pages(
            array_slice($imageBytesList, 1),
            $region,
            $accessKey,
            $secretKey
        );
        if (!empty($textResult['ok']) && !empty($textResult['mapped'])) {
            $mapped = waiver_id_scan_merge_mapped($mapped, $textResult['mapped']);
        }
    }

    return ['ok' => true, 'mapped' => $mapped];
}

/**
 * @param array<int, string> $imageBytesList
 */
function waiver_id_scan_detect_text_pages(
    array $imageBytesList,
    string $region,
    string $accessKey,
    string $secretKey
): array {
    $allLines = [];
    foreach ($imageBytesList as $bytes) {
        if ($bytes === '') {
            continue;
        }
        $payload = json_encode([
            'Document' => ['Bytes' => base64_encode($bytes)],
        ], JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            continue;
        }
        $host = "textract.{$region}.amazonaws.com";
        $target = 'Textract.DetectDocumentText';
        $headers = waiver_id_scan_aws_sign(
            'POST',
            $host,
            '/',
            $payload,
            $region,
            'textract',
            $accessKey,
            $secretKey,
            $target
        );
        $headerLines = [];
        foreach ($headers as $k => $v) {
            $headerLines[] = "{$k}: {$v}";
        }
        if (!function_exists('curl_init')) {
            break;
        }
        $ch = curl_init("https://{$host}/");
        if ($ch === false) {
            continue;
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => $headerLines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 40,
            CURLOPT_CONNECTTIMEOUT => 12,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if (!is_string($body) || $body === '') {
            continue;
        }
        $json = json_decode($body, true);
        if (!is_array($json)) {
            continue;
        }
        if ($status >= 400) {
            $awsErr = waiver_id_scan_aws_error_result(
                $json,
                $status,
                'We could not read typed text from that document. Use a clearer printed page or fill manually.'
            );
            if (in_array(($awsErr['code'] ?? ''), ['aws_subscription', 'aws_credentials', 'aws_access'], true)) {
                return $awsErr;
            }
            continue;
        }
        foreach ($json['Blocks'] ?? [] as $block) {
            if (!is_array($block)) {
                continue;
            }
            if (($block['BlockType'] ?? '') === 'LINE') {
                $t = trim((string) ($block['Text'] ?? ''));
                if ($t !== '') {
                    $allLines[] = $t;
                }
            }
        }
    }

    if (!$allLines) {
        return [
            'ok' => false,
            'message' => 'We could not read typed text from that document. Use a clearer printed page or fill manually.',
            'fallback' => 'manual',
        ];
    }

    $mapped = waiver_id_scan_parse_text_lines($allLines);
    return ['ok' => true, 'mapped' => $mapped, 'lines' => $allLines];
}

/**
 * @param array<string, mixed> $textract
 * @return array<string, mixed>
 */
function waiver_id_scan_map_query_result(array $textract): array
{
    $answers = [];
    // Prefer QueryResult linked from Query aliases
    $blockById = [];
    foreach ($textract['Blocks'] ?? [] as $block) {
        if (is_array($block) && isset($block['Id'])) {
            $blockById[(string) $block['Id']] = $block;
        }
    }
    foreach ($textract['Blocks'] ?? [] as $block) {
        if (!is_array($block) || ($block['BlockType'] ?? '') !== 'QUERY') {
            continue;
        }
        $alias = (string) ($block['Query']['Alias'] ?? '');
        if ($alias === '') {
            continue;
        }
        foreach ($block['Relationships'] ?? [] as $rel) {
            if (!is_array($rel) || ($rel['Type'] ?? '') !== 'ANSWER') {
                continue;
            }
            foreach ($rel['Ids'] ?? [] as $id) {
                $ans = $blockById[(string) $id] ?? null;
                if (!is_array($ans)) {
                    continue;
                }
                $text = trim((string) ($ans['Text'] ?? ''));
                $conf = (float) ($ans['Confidence'] ?? 0);
                if ($text === '') {
                    continue;
                }
                if (!isset($answers[$alias]) || $conf >= (float) ($answers[$alias]['confidence'] ?? 0)) {
                    $answers[$alias] = ['value' => $text, 'confidence' => $conf];
                }
            }
        }
    }

    $get = static function (string $key) use ($answers): string {
        return trim((string) ($answers[$key]['value'] ?? ''));
    };

    $first = waiver_id_scan_title_case($get('FIRST_NAME'));
    $last = waiver_id_scan_title_case($get('LAST_NAME'));
    $fullName = $get('FULL_NAME');
    if (($first === '' || $last === '') && $fullName !== '') {
        if (preg_match('/^([A-Za-z][A-Za-z\'\-]+)\s*,\s*([A-Za-z][A-Za-z\'\-\s]+)$/', $fullName, $m)) {
            if ($last === '') {
                $last = waiver_id_scan_title_case($m[1]);
            }
            if ($first === '') {
                $first = waiver_id_scan_title_case(trim($m[2]));
            }
        } else {
            $parts = preg_split('/\s+/', $fullName) ?: [];
            if ($first === '' && isset($parts[0])) {
                $first = waiver_id_scan_title_case($parts[0]);
            }
            if ($last === '' && count($parts) > 1) {
                $last = waiver_id_scan_title_case((string) end($parts));
            }
        }
    }

    $dobHint = $get('DATE_OF_BIRTH') . ' ' . $fullName . ' ' . $get('ADDRESS') . ' ' . $get('STATE');
    $preferDayFirst = (bool) preg_match('/nigeria|licence|fct|abuja|\bdd[\/\-]/i', $dobHint);
    $dob = waiver_id_scan_parse_date($get('DATE_OF_BIRTH'), $preferDayFirst);
    $phone = waiver_id_scan_clean_phone($get('PHONE'));
    $address = waiver_id_scan_title_case($get('ADDRESS'));
    $city = waiver_id_scan_title_case($get('CITY'));
    $state = $get('STATE');
    $zip = $get('ZIP');
    if (strlen($state) === 2) {
        $state = strtoupper($state);
    } else {
        $state = waiver_id_scan_title_case($state);
    }

    if ($address !== '' && ($city === '' || $state === '' || $zip === '')) {
        $parsed = waiver_id_scan_split_address_block($address);
        if ($city === '' && $parsed['city'] !== '') {
            $city = waiver_id_scan_title_case($parsed['city']);
        }
        if ($state === '' && $parsed['state'] !== '') {
            $state = strlen($parsed['state']) === 2 ? strtoupper($parsed['state']) : waiver_id_scan_title_case($parsed['state']);
        }
        if ($zip === '' && $parsed['zip'] !== '') {
            $zip = $parsed['zip'];
        }
        if ($parsed['street'] !== '') {
            $address = waiver_id_scan_title_case($parsed['street']);
        }
    }

    return waiver_id_scan_pack_mapped($first, $last, $dob, $address, $city, $state, $zip, $phone);
}

/**
 * @param list<string> $lines
 * @return array<string, mixed>
 */
function waiver_id_scan_parse_text_lines(array $lines): array
{
    $blob = implode("\n", $lines);
    $preferDayFirst = (bool) preg_match(
        '/nigeria|nigerian|licence|federal republic|abuja|\bfct\b|lagos|driver.?s?\s+licen/i',
        $blob
    );
    $first = '';
    $last = '';
    $dobRaw = '';
    $phone = '';
    $emergencyName = '';
    $emergencyPhone = '';
    $address = '';
    $city = '';
    $state = '';
    $zip = '';

    foreach ($lines as $idx => $line) {
        $line = trim((string) $line);
        if ($line === '') {
            continue;
        }
        // Skip licence chrome / legend lines that are not personal details
        if (preg_match(
            '/^(federal|republic|nigeria|national|drivers?\s*licen|class of|endorsements?|index|blood group|glasses|facial|signature|private class|iss\.?$|exp\.?$|1st\s*iss)/i',
            $line
        )) {
            continue;
        }
        if (preg_match('/\b(class of licence|endorsements?|gross weight|omnibus|administrative fee)\b/i', $line)) {
            continue;
        }

        // Checklist / labeled lines: "First name: Daniel"
        if ($first === '' && preg_match('/^(?:first\s*name|given\s*name)\s*[:\-]\s*(.+)$/i', $line, $m)) {
            $first = trim($m[1]);
        }
        if ($last === '' && preg_match('/^(?:last\s*name|surname|family\s*name)\s*[:\-]\s*(.+)$/i', $line, $m)) {
            $last = trim($m[1]);
        }
        if ($dobRaw === '' && preg_match('/^(?:date\s*of\s*birth|d\.?\s*o\.?\s*b\.?|dob|birth\s*date)\s*[:\-]\s*(.+)$/i', $line, $m)) {
            if (preg_match('/\b(\d{1,4}[\/\-.]?\d{1,2}[\/\-.]?\d{1,4})\b/', $m[1], $dm)) {
                $dobRaw = $dm[1];
            } else {
                $dobRaw = trim($m[1]);
            }
        }
        if ($emergencyName === '' && preg_match(
            '/^(?:emergency\s*contact(?:\s*name)?|emergency\s*name|next\s*of\s*kin(?:\s*name)?)\s*[:\-]\s*(.+)$/i',
            $line,
            $m
        )) {
            $emergencyName = trim($m[1]);
        }
        if ($emergencyPhone === '' && preg_match(
            '/^(?:emergency\s*(?:contact\s*)?(?:phone|tel|mobile|number)|ice\s*(?:phone|contact))\s*[:\-]\s*(.+)$/i',
            $line,
            $m
        )) {
            $emergencyPhone = waiver_id_scan_clean_phone($m[1]);
        }
        if ($phone === '' && !preg_match('/emergency|next\s*of\s*kin|\bice\b/i', $line)
            && preg_match('/^(?:phone(?:\s*number)?|mobile(?:\s*number)?|tel(?:ephone)?|cell)\s*[:\-]\s*(.+)$/i', $line, $m)) {
            $phone = waiver_id_scan_clean_phone($m[1]);
        }
        if ($address === '' && preg_match('/^(?:street\s*address|address|residential\s*address)\s*[:\-]\s*(.+)$/i', $line, $m)) {
            $address = trim($m[1]);
        }
        if ($city === '' && preg_match('/^(?:city|town)\s*[:\-]\s*(.+)$/i', $line, $m)) {
            $city = trim($m[1]);
        }
        if ($state === '' && preg_match('/^(?:state(?:\s*\/\s*province)?|province|fct)\s*[:\-]\s*(.+)$/i', $line, $m)) {
            $state = trim($m[1]);
        }
        if ($zip === '' && preg_match('/^(?:zip(?:\s*\/\s*postal)?(?:\s*code)?|postal(?:\s*code)?)\s*[:\-]\s*(.+)$/i', $line, $m)) {
            $zip = trim($m[1]);
        }

        if ($phone === '' && preg_match(
            '/\b(?:phone|mobile|tel|telephone|cell)\b[:\s]*([+\d][\d\s().\-]{6,}\d)/i',
            $line,
            $m
        )) {
            $phone = waiver_id_scan_clean_phone($m[1]);
        }
        if ($phone === '' && preg_match('/(?:\+|00)?\d[\d\s().\-]{8,}\d/', $line, $m)) {
            // Prefer lines that look like phone context or long digit runs
            if (preg_match('/phone|mobile|tel|cell/i', $line) || preg_match('/^\+?\d/', trim($line))) {
                $candidate = waiver_id_scan_clean_phone($m[0]);
                if (strlen(preg_replace('/\D/', '', $candidate)) >= 7) {
                    $phone = $candidate;
                }
            }
        }

        // "ADEGOKE, DAVID ADEYINIKA" / "LAST, FIRST MIDDLE"
        if (($first === '' || $last === '') && preg_match(
            '/^([A-Z][A-Z\'\-]+),\s*([A-Z][A-Z\'\-]+(?:\s+[A-Z][A-Z\'\-]+)*)$/i',
            $line,
            $m
        )) {
            $last = $last !== '' ? $last : $m[1];
            $first = $first !== '' ? $first : $m[2];
        }

        // Name: ADEGOKE, DAVID … or Surname / Given name labels
        if (($first === '' || $last === '') && preg_match(
            '/\b(?:name|surname|family name|full name)\b[:\s]*([A-Z][A-Z\'\-]+)\s*,\s*([A-Z][A-Z\'\-\s]+)/i',
            $line,
            $m
        )) {
            $last = $last !== '' ? $last : trim($m[1]);
            $first = $first !== '' ? $first : trim($m[2]);
        }

        if ($dobRaw === '' && preg_match(
            '/\b(?:dob|date of birth|birth ?date|d\.?o\.?b\.?)\b[:\s-]*([0-9]{1,4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{1,4})/i',
            $line,
            $m
        )) {
            $dobRaw = $m[1];
        }
        if ($dobRaw === '' && preg_match('/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/', $line, $m)) {
            if (preg_match('/birth|dob|born/i', $line)) {
                $dobRaw = $m[1];
            }
        }

        if ($zip === '' && preg_match('/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i', $line, $m)) {
            $state = strtoupper($m[1]);
            $zip = $m[2];
            if (preg_match('/^(.+?),\s*[A-Z]{2}\s+\d{5}/i', $line, $cm)) {
                $city = trim($cm[1]);
            } elseif (preg_match('/^(.+?)\s+[A-Z]{2}\s+\d{5}/i', $line, $cm)) {
                $cityPart = trim($cm[1]);
                if (!preg_match('/\d/', $cityPart)) {
                    $city = $cityPart;
                } else {
                    $address = $cityPart;
                }
            }
        }

        // Street lines: "NO. 9, SPRINGS BOULEVARD…" / "123 Main Street"
        if ($address === '' && preg_match(
            '/^(?:NO\.?\s*)?\d+[\w\s.,\'\-\/]*\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|court|ct|way|close|crescent|estate|district|avenue)\b/i',
            $line
        )) {
            $address = $line;
        }

        // Nigerian / intl city + region: "ABUJA, FCT" / "LAGOS STATE"
        if (($city === '' || $state === '') && preg_match(
            '/\b([A-Z][A-Za-z\s]+?),\s*(FCT|[A-Z]{2,}|[A-Z][A-Za-z]+(?:\s+STATE)?)\b/',
            $line,
            $m
        )) {
            if ($city === '' && !preg_match('/^\d/', $m[1])) {
                $city = trim($m[1]);
            }
            if ($state === '') {
                $state = trim($m[2]);
                $state = preg_replace('/\s+STATE$/i', '', $state) ?: $state;
            }
        }

        if (($first === '' || $last === '') && preg_match(
            '/\b(?:name|full name|patient|guest|applicant|holder)\b[:\s]+([A-Za-z][A-Za-z\'\-]+(?:\s+[A-Za-z][A-Za-z\'\-]+)+)/i',
            $line,
            $m
        )) {
            $parts = preg_split('/\s+/', trim($m[1])) ?: [];
            if (count($parts) >= 2) {
                $first = $first !== '' ? $first : $parts[0];
                $last = $last !== '' ? $last : (string) end($parts);
            }
        }

        // Label on this line, value on next (common on licence layouts)
        if (($first === '' || $last === '') && preg_match('/^(?:name|surname|family name)\b[:\s]*$/i', $line)) {
            $next = trim((string) ($lines[$idx + 1] ?? ''));
            if (preg_match('/^([A-Z][A-Z\'\-]+),\s*([A-Z][A-Z\'\-\s]+)$/i', $next, $m)) {
                $last = $last !== '' ? $last : $m[1];
                $first = $first !== '' ? $first : trim($m[2]);
            }
        }
        if ($address === '' && preg_match('/^(?:address|residential address|addr)\b[:\s]*$/i', $line)) {
            $next = trim((string) ($lines[$idx + 1] ?? ''));
            if ($next !== '' && strlen($next) > 8) {
                $address = $next;
            }
        }
        if ($dobRaw === '' && preg_match('/^(?:date of birth|dob|birth date)\b[:\s]*$/i', $line)) {
            $next = trim((string) ($lines[$idx + 1] ?? ''));
            if (preg_match('/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/', $next, $m)) {
                $dobRaw = $m[1];
            }
        }
    }

    // Fallback: first ALL-CAPS "LAST, FIRST…" line
    if ($first === '' || $last === '') {
        foreach ($lines as $line) {
            $line = trim((string) $line);
            if (preg_match('/^([A-Z][A-Z\'\-]+),\s*([A-Z][A-Z\'\-]+(?:\s+[A-Z][A-Z\'\-]+){0,3})$/', $line, $m)) {
                $last = $last !== '' ? $last : $m[1];
                $first = $first !== '' ? $first : $m[2];
                break;
            }
        }
    }

    // Fallback: first line that looks like "First Last"
    if ($first === '' || $last === '') {
        foreach ($lines as $line) {
            if (preg_match('/^[A-Z][a-zA-Z\'\-]+\s+[A-Z][a-zA-Z\'\-]+(?:\s+[A-Z][a-zA-Z\'\-]+)?$/', trim($line))) {
                $parts = preg_split('/\s+/', trim($line)) ?: [];
                if (count($parts) >= 2) {
                    $first = $first !== '' ? $first : $parts[0];
                    $last = $last !== '' ? $last : (string) end($parts);
                    break;
                }
            }
        }
    }

    if ($dobRaw === '') {
        foreach ($lines as $line) {
            if (preg_match('/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/', $line, $m)) {
                // Skip likely issue/expiry years in the far future relative to now+1
                $candidate = $m[1];
                $parsedTry = waiver_id_scan_parse_date($candidate, $preferDayFirst);
                if (($parsedTry['iso'] ?? '') !== '') {
                    $y = (int) ($parsedTry['year'] ?? 0);
                    if ($y >= 1920 && $y <= ((int) date('Y'))) {
                        $dobRaw = $candidate;
                        break;
                    }
                }
            }
        }
    }

    // Pull city/state from a long address line when still missing
    if ($address !== '' && ($city === '' || $state === '')) {
        if (preg_match('/\b(ABUJA|LAGOS|KANO|IBADAN|PORT\s*HARCOURT)\b/i', $address, $m)) {
            if ($city === '') {
                $city = $m[1];
            }
        }
        if (preg_match('/\b(FCT|[A-Z]{2,}\s+STATE)\b/i', $address, $m)) {
            if ($state === '') {
                $state = preg_replace('/\s+STATE$/i', '', trim($m[1])) ?: trim($m[1]);
            }
        }
    }

    $dob = waiver_id_scan_parse_date($dobRaw, $preferDayFirst);
    return waiver_id_scan_pack_mapped(
        waiver_id_scan_title_case($first),
        waiver_id_scan_title_case($last),
        $dob,
        waiver_id_scan_title_case($address),
        waiver_id_scan_title_case($city),
        strlen($state) === 2 ? strtoupper($state) : waiver_id_scan_title_case($state),
        $zip,
        $phone,
        waiver_id_scan_title_case($emergencyName),
        $emergencyPhone
    );
}

/**
 * Normalize a phone string for the waiver phone field (national digits preferred).
 */
function waiver_id_scan_clean_phone(string $raw): string
{
    $raw = trim($raw);
    if ($raw === '') {
        return '';
    }
    // Keep leading + then digits; strip other punctuation for storage in the national field.
    $compact = preg_replace('/[^\d+]/', '', $raw) ?: '';
    if ($compact === '') {
        return '';
    }
    // Drop common country prefixes so the dial selector can stay as chosen by the guest.
    if (str_starts_with($compact, '+')) {
        $compact = substr($compact, 1);
    }
    if (str_starts_with($compact, '00')) {
        $compact = substr($compact, 2);
    }
    // US/CA 1 + 10 digits
    if (preg_match('/^1(\d{10})$/', $compact, $m)) {
        return $m[1];
    }
    // Nigeria 234…
    if (preg_match('/^234(\d{7,11})$/', $compact, $m)) {
        return '0' . $m[1];
    }
    return mb_substr($compact, 0, 40);
}

/**
 * @param array{iso:string,month:string,day:string,year:string} $dob
 * @return array<string, mixed>
 */
function waiver_id_scan_pack_mapped(
    string $first,
    string $last,
    array $dob,
    string $address,
    string $city,
    string $state,
    string $zip,
    string $phone = '',
    string $emergencyName = '',
    string $emergencyPhone = ''
): array {
    $mapped = [
        'first_name' => mb_substr($first, 0, 80),
        'last_name' => mb_substr($last, 0, 80),
        'dob' => $dob['iso'],
        'dob_month' => $dob['month'],
        'dob_day' => $dob['day'],
        'dob_year' => $dob['year'],
        'phone' => mb_substr(trim($phone), 0, 40),
        'address' => mb_substr($address, 0, 160),
        'city' => mb_substr($city, 0, 80),
        'state' => mb_substr($state, 0, 80),
        'zip' => mb_substr($zip, 0, 20),
        'emergency_name' => mb_substr(trim($emergencyName), 0, 120),
        'emergency_phone' => mb_substr(trim($emergencyPhone), 0, 40),
    ];
    $filled = 0;
    foreach (['first_name', 'last_name', 'dob', 'phone', 'address', 'city', 'state', 'zip', 'emergency_name', 'emergency_phone'] as $k) {
        if ($mapped[$k] !== '') {
            $filled++;
        }
    }
    return [
        'fields' => $mapped,
        'filled_count' => $filled,
        'has_name' => $mapped['first_name'] !== '' && $mapped['last_name'] !== '',
        'has_dob' => $mapped['dob'] !== '',
        'has_address' => $mapped['address'] !== '' || ($mapped['city'] !== '' && $mapped['zip'] !== ''),
        'has_phone' => $mapped['phone'] !== '',
        'has_emergency' => $mapped['emergency_name'] !== '' || $mapped['emergency_phone'] !== '',
    ];
}

/**
 * @param array<string, mixed> $a
 * @param array<string, mixed> $b
 * @return array<string, mixed>
 */
function waiver_id_scan_merge_mapped(array $a, array $b): array
{
    $fa = is_array($a['fields'] ?? null) ? $a['fields'] : [];
    $fb = is_array($b['fields'] ?? null) ? $b['fields'] : [];
    $out = $fa;
    foreach ($fb as $k => $v) {
        if (!is_string($v) || $v === '') {
            continue;
        }
        if (!isset($out[$k]) || $out[$k] === '') {
            $out[$k] = $v;
        }
    }
    $dob = [
        'iso' => (string) ($out['dob'] ?? ''),
        'month' => (string) ($out['dob_month'] ?? ''),
        'day' => (string) ($out['dob_day'] ?? ''),
        'year' => (string) ($out['dob_year'] ?? ''),
    ];
    return waiver_id_scan_pack_mapped(
        (string) ($out['first_name'] ?? ''),
        (string) ($out['last_name'] ?? ''),
        $dob,
        (string) ($out['address'] ?? ''),
        (string) ($out['city'] ?? ''),
        (string) ($out['state'] ?? ''),
        (string) ($out['zip'] ?? ''),
        (string) ($out['phone'] ?? ''),
        (string) ($out['emergency_name'] ?? ''),
        (string) ($out['emergency_phone'] ?? '')
    );
}

// --- Request body ---
$raw = file_get_contents('php://input');
$input = is_string($raw) ? json_decode($raw, true) : null;
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid request.'], JSON_UNESCAPED_UNICODE);
    exit;
}

// Lightweight honeypot — pretend success with empty, unusable fields (client requires has_name).
if (trim((string) ($input['website'] ?? '')) !== '') {
    echo json_encode([
        'ok' => true,
        'fields' => [
            'first_name' => '', 'last_name' => '', 'dob' => '', 'dob_month' => '', 'dob_day' => '', 'dob_year' => '',
            'phone' => '', 'address' => '', 'city' => '', 'state' => '', 'zip' => '',
            'emergency_name' => '', 'emergency_phone' => '',
        ],
        'filled_count' => 0,
        'has_name' => false,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!waiver_id_scan_rate_ok($rateSeconds)) {
    http_response_code(429);
    echo json_encode([
        'ok' => false,
        'message' => 'Please wait a few seconds before scanning again.',
        'fallback' => 'manual',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$scanMode = strtolower(trim((string) ($input['mode'] ?? 'id')));
if ($scanMode !== 'document') {
    $scanMode = 'id';
}

@set_time_limit(180);
ignore_user_abort(true);

$front = waiver_id_scan_decode_image((string) ($input['front'] ?? ''), $maxBytes);
$back = waiver_id_scan_decode_image((string) ($input['back'] ?? ''), $maxBytes);
$frontClientVariants = waiver_id_scan_decode_variant_list($input['front_variants'] ?? [], $maxBytes, 4);
$backClientVariants = waiver_id_scan_decode_variant_list($input['back_variants'] ?? [], $maxBytes, 4);

if ($scanMode === 'id') {
    if ($front === null) {
        http_response_code(400);
        echo json_encode([
            'ok' => false,
            'message' => 'Please upload a clear front photo of your ID (JPEG or PNG).',
            'fallback' => 'manual',
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $frontBytes = $front['bytes'];
    $backBytes = $back !== null ? $back['bytes'] : '';
    unset($front, $back, $input);

    $mapped = [
        'fields' => [],
        'filled_count' => 0,
        'has_name' => false,
        'has_dob' => false,
        'has_address' => false,
    ];
    $bestScore = 0;

    $keepBest = static function (array $candidate) use (&$mapped, &$bestScore): void {
        if (empty($candidate) || !is_array($candidate)) {
            return;
        }
        $merged = waiver_id_scan_merge_mapped($mapped, $candidate);
        $score = waiver_id_scan_score_mapped($merged);
        if ($score >= $bestScore) {
            $mapped = $merged;
            $bestScore = $score;
        }
    };

    // Build orientation set: client rotations (works even if server GD is missing) + server GD
    $frontPages = waiver_id_scan_unique_pages(array_merge(
        [$frontBytes],
        $frontClientVariants,
        waiver_id_scan_orientation_variants($frontBytes)
    ), 4);
    $backPages = $backBytes !== ''
        ? waiver_id_scan_unique_pages(array_merge(
            [$backBytes],
            $backClientVariants,
            waiver_id_scan_orientation_variants($backBytes)
        ), 4)
        : [];

    // 1) US-style AnalyzeID (front required; back optional if still provided)
    $analyzePages = $backBytes !== '' ? [$frontBytes, $backBytes] : [$frontBytes];
    $result = waiver_id_scan_analyze_id(
        $analyzePages,
        $region,
        $accessKey,
        $secretKey
    );
    if (!empty($result['ok'])) {
        $keepBest(waiver_id_scan_map_fields($result['data'] ?? []));
    } elseif (in_array((string) ($result['code'] ?? ''), ['aws_subscription', 'aws_credentials', 'aws_access'], true)) {
        http_response_code(!empty($result['http']) ? (int) $result['http'] : 503);
        echo json_encode([
            'ok' => false,
            'message' => (string) ($result['message'] ?? 'ID scan service is not available.'),
            'fallback' => 'manual',
            'code' => $result['code'] ?? 'aws_error',
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // 2) Sideways / non-US IDs: DetectDocumentText on EACH front orientation until strong
    if (waiver_id_scan_mapped_weak($mapped)) {
        foreach ($frontPages as $page) {
            $textResult = waiver_id_scan_detect_text_pages(
                [$page],
                $region,
                $accessKey,
                $secretKey
            );
            if (in_array((string) ($textResult['code'] ?? ''), ['aws_subscription', 'aws_credentials', 'aws_access'], true)) {
                http_response_code(!empty($textResult['http']) ? (int) $textResult['http'] : 503);
                echo json_encode([
                    'ok' => false,
                    'message' => (string) ($textResult['message'] ?? 'ID scan service is not available.'),
                    'fallback' => 'manual',
                    'code' => $textResult['code'] ?? 'aws_error',
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }
            if (!empty($textResult['ok']) && !empty($textResult['mapped'])) {
                $keepBest($textResult['mapped']);
            }
            if (!waiver_id_scan_mapped_weak($mapped) && $bestScore >= 11) {
                break;
            }
        }
    }

    // 3) AnalyzeDocument queries on each front orientation (helps structured layouts)
    if (waiver_id_scan_mapped_weak($mapped)) {
        foreach ($frontPages as $page) {
            $docResult = waiver_id_scan_analyze_document(
                [$page],
                $region,
                $accessKey,
                $secretKey
            );
            if (in_array((string) ($docResult['code'] ?? ''), ['aws_subscription', 'aws_credentials', 'aws_access'], true)) {
                http_response_code(!empty($docResult['http']) ? (int) $docResult['http'] : 503);
                echo json_encode([
                    'ok' => false,
                    'message' => (string) ($docResult['message'] ?? 'ID scan service is not available.'),
                    'fallback' => 'manual',
                    'code' => $docResult['code'] ?? 'aws_error',
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }
            if (!empty($docResult['ok']) && !empty($docResult['mapped'])) {
                $keepBest($docResult['mapped']);
            }
            if (!waiver_id_scan_mapped_weak($mapped) && $bestScore >= 11) {
                break;
            }
        }
    }

    // 4) Optional back side text (legacy clients may still send it)
    if ($backPages && (waiver_id_scan_mapped_weak($mapped) || empty($mapped['has_dob']))) {
        foreach (array_slice($backPages, 0, 3) as $page) {
            $textResult = waiver_id_scan_detect_text_pages(
                [$page],
                $region,
                $accessKey,
                $secretKey
            );
            if (!empty($textResult['ok']) && !empty($textResult['mapped'])) {
                $keepBest($textResult['mapped']);
            }
            if (!empty($mapped['has_name']) && !empty($mapped['has_dob'])) {
                break;
            }
        }
    }

    unset($frontBytes, $backBytes, $frontPages, $backPages, $frontClientVariants, $backClientVariants);
} else {
    // Typed / printed document — same multi-angle OCR as ID (sideways phone photos)
    if ($front === null) {
        http_response_code(400);
        echo json_encode([
            'ok' => false,
            'message' => 'Please upload a clear photo of your typed or printed document.',
            'fallback' => 'manual',
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $frontBytes = $front['bytes'];
    $backBytes = $back !== null ? $back['bytes'] : '';
    unset($front, $back, $input);

    $mapped = [
        'fields' => [],
        'filled_count' => 0,
        'has_name' => false,
        'has_dob' => false,
        'has_address' => false,
    ];
    $bestScore = 0;

    $keepBest = static function (array $candidate) use (&$mapped, &$bestScore): void {
        if (empty($candidate) || !is_array($candidate)) {
            return;
        }
        $merged = waiver_id_scan_merge_mapped($mapped, $candidate);
        $score = waiver_id_scan_score_mapped($merged);
        if ($score >= $bestScore) {
            $mapped = $merged;
            $bestScore = $score;
        }
    };

    $frontPages = waiver_id_scan_unique_pages(array_merge(
        [$frontBytes],
        $frontClientVariants,
        waiver_id_scan_orientation_variants($frontBytes)
    ), 4);

    $backPages = [];
    if ($backBytes !== '') {
        $backPages = waiver_id_scan_unique_pages(array_merge(
            [$backBytes],
            $backClientVariants,
            waiver_id_scan_orientation_variants($backBytes)
        ), 3);
    }

    // 1) DetectDocumentText on each upright/rotated front page
    foreach ($frontPages as $page) {
        $textResult = waiver_id_scan_detect_text_pages(
            [$page],
            $region,
            $accessKey,
            $secretKey
        );
        if (in_array((string) ($textResult['code'] ?? ''), ['aws_subscription', 'aws_credentials', 'aws_access'], true)) {
            http_response_code(!empty($textResult['http']) ? (int) $textResult['http'] : 503);
            echo json_encode([
                'ok' => false,
                'message' => (string) ($textResult['message'] ?? 'Document scan service is not available.'),
                'fallback' => 'manual',
                'code' => $textResult['code'] ?? 'aws_error',
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (!empty($textResult['ok']) && !empty($textResult['mapped'])) {
            $keepBest($textResult['mapped']);
        }
        if (!waiver_id_scan_mapped_weak($mapped) && $bestScore >= 11) {
            break;
        }
    }

    // 2) AnalyzeDocument queries on each front orientation
    if (waiver_id_scan_mapped_weak($mapped)) {
        foreach ($frontPages as $page) {
            $docResult = waiver_id_scan_analyze_document(
                [$page],
                $region,
                $accessKey,
                $secretKey
            );
            if (in_array((string) ($docResult['code'] ?? ''), ['aws_subscription', 'aws_credentials', 'aws_access'], true)) {
                http_response_code(!empty($docResult['http']) ? (int) $docResult['http'] : 503);
                echo json_encode([
                    'ok' => false,
                    'message' => (string) ($docResult['message'] ?? 'Document scan service is not available.'),
                    'fallback' => 'manual',
                    'code' => $docResult['code'] ?? 'aws_error',
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }
            if (!empty($docResult['ok']) && !empty($docResult['mapped'])) {
                $keepBest($docResult['mapped']);
            }
            if (!waiver_id_scan_mapped_weak($mapped) && $bestScore >= 11) {
                break;
            }
        }
    }

    // 3) Optional second page
    if (($backPages !== []) && (waiver_id_scan_mapped_weak($mapped) || empty($mapped['has_dob']) || empty($mapped['has_phone']))) {
        foreach ($backPages as $page) {
            $textResult = waiver_id_scan_detect_text_pages(
                [$page],
                $region,
                $accessKey,
                $secretKey
            );
            if (!empty($textResult['ok']) && !empty($textResult['mapped'])) {
                $keepBest($textResult['mapped']);
            }
            if (!waiver_id_scan_mapped_weak($mapped) && !empty($mapped['has_dob'])) {
                break;
            }
        }
    }

    unset($frontBytes, $backBytes, $frontPages, $backPages, $frontClientVariants, $backClientVariants);
}

if (($mapped['filled_count'] ?? 0) < 2 || empty($mapped['has_name'])) {
    http_response_code(422);
    echo json_encode([
        'ok' => false,
        'message' => $scanMode === 'document'
            ? 'We could not read enough typed details. Retake a clearer upright photo of the checklist page (not handwriting), or fill manually.'
            : 'We could not read that ID clearly. Sideways photos are retried automatically — retake in good light or fill manually.',
        'fallback' => 'manual',
        'fields' => $mapped['fields'] ?? null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'ok' => true,
    'mode' => $scanMode,
    'message' => $scanMode === 'document'
        ? 'Typed details extracted. Please review and complete any missing fields.'
        : 'Details extracted. Please review and complete any missing fields.',
    'fields' => $mapped['fields'],
    'filled_count' => $mapped['filled_count'],
    'has_name' => $mapped['has_name'],
    'has_dob' => $mapped['has_dob'],
    'has_address' => $mapped['has_address'],
], JSON_UNESCAPED_UNICODE);
