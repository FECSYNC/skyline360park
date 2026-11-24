<?php
/**
 * Skyline 360 Park — per-location waiver routing
 *
 * Emails: created on skyline360park.com (katy@ / fortworth@ / pennsylvania@).
 * Park booking sites after waiver:
 *   Katy, Texas         → booking.skyline360park.com
 *   Fort Worth, Texas   → texasfortworth.skyline360park.com
 *   Pennsylvania → pennsylvaniapa.skyline360park.com
 * Keep in sync with js/parks-data.js booking.notifyEmail / bookingPages.
 */
declare(strict_types=1);

if (count(get_included_files()) === 1) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Forbidden';
    exit;
}

const WAIVER_PLAN_LABELS = [
    'general' => 'General Visit',
    'kids' => 'Kids & Family',
    'membership' => 'Membership',
    'groups' => 'Groups',
    'party' => 'Party Packages',
    'walkin' => 'Walk-in',
];

/**
 * @return array<string, array{
 *   name: string,
 *   shortName: string,
 *   fromEmail: string,
 *   fromName: string,
 *   notify: list<string>,
 *   plans: array<string, array{label: string, redirect: string}>
 * }>
 */
function waiver_parks_registry(): array
{
    return [
        'katy' => [
            'name' => 'Katy, Texas',
            'shortName' => 'Katy, Texas',
            'address' => '923 S. Mason Road, Suite A, Katy, TX 77450',
            'phone' => '(469) 922-3788',
            'fromEmail' => 'katy@skyline360park.com',
            'fromName' => 'Skyline 360 Park - Katy, Texas',
            'notify' => [
                'katy@skyline360park.com',
                // 'manager@example.com',
            ],
            'plans' => [
                'general' => [
                    'label' => 'General Visit',
                    'redirect' => 'https://www.booking.skyline360park.com/product-category/general-visit/',
                ],
                'kids' => [
                    'label' => 'Kids & Family',
                    'redirect' => 'https://www.booking.skyline360park.com/product-category/kids-family/',
                ],
                'membership' => [
                    'label' => 'Membership',
                    'redirect' => 'https://www.booking.skyline360park.com/product-category/membership-plan/',
                ],
                'groups' => [
                    'label' => 'Groups',
                    'redirect' => 'https://www.booking.skyline360park.com/product-category/groups-plan/',
                ],
                'party' => [
                    'label' => 'Party Packages',
                    'redirect' => 'https://www.booking.skyline360park.com/product-category/party-packages/',
                ],
            ],
        ],
        'fort-worth' => [
            'name' => 'Fort Worth, Texas',
            'shortName' => 'Fort Worth, Texas',
            'address' => 'Fort Worth, Texas',
            'phone' => '(469) 922-3788',
            'fromEmail' => 'fortworth@skyline360park.com',
            'fromName' => 'Skyline 360 Park - Fort Worth, Texas',
            'notify' => [
                'fortworth@skyline360park.com',
            ],
            'plans' => [
                'general' => [
                    'label' => 'General Visit',
                    'redirect' => 'https://texasfortworth.skyline360park.com/product-category/general-visit/',
                ],
                'kids' => [
                    'label' => 'Kids & Family',
                    'redirect' => 'https://texasfortworth.skyline360park.com/product-category/kids-family/',
                ],
                'membership' => [
                    'label' => 'Membership',
                    'redirect' => 'https://texasfortworth.skyline360park.com/product-category/membership-plan/',
                ],
                'groups' => [
                    'label' => 'Groups',
                    'redirect' => 'https://texasfortworth.skyline360park.com/product-category/groups-plan/',
                ],
                'party' => [
                    'label' => 'Party Packages',
                    'redirect' => 'https://texasfortworth.skyline360park.com/product-category/party-packages/',
                ],
            ],
        ],
        'pennsylvania' => [
            'name' => 'Pennsylvania',
            'shortName' => 'Pennsylvania',
            'address' => 'Pennsylvania',
            'phone' => '(469) 922-3788',
            'fromEmail' => 'pennsylvania@skyline360park.com',
            'fromName' => 'Skyline 360 Park - Pennsylvania',
            'notify' => [
                'pennsylvania@skyline360park.com',
            ],
            'plans' => [
                'general' => [
                    'label' => 'General Visit',
                    'redirect' => 'https://pennsylvaniapa.skyline360park.com/product-category/general-visit/',
                ],
                'kids' => [
                    'label' => 'Kids & Family',
                    'redirect' => 'https://pennsylvaniapa.skyline360park.com/product-category/kids-family/',
                ],
                'membership' => [
                    'label' => 'Membership',
                    'redirect' => 'https://pennsylvaniapa.skyline360park.com/product-category/membership-plan/',
                ],
                'groups' => [
                    'label' => 'Groups',
                    'redirect' => 'https://pennsylvaniapa.skyline360park.com/product-category/groups-plan/',
                ],
                'party' => [
                    'label' => 'Party Packages',
                    'redirect' => 'https://pennsylvaniapa.skyline360park.com/product-category/party-packages/',
                ],
            ],
        ],
    ];
}

function waiver_resolve_park(string $parkId): ?array
{
    $parkId = strtolower(trim($parkId));
    $registry = waiver_parks_registry();
    return $registry[$parkId] ?? null;
}

function waiver_resolve_plan(array $park, string $planId): ?array
{
    $planId = strtolower(trim($planId));
    // Navbar walk-in: park waiver without locking a single plan.
    if ($planId === 'walkin') {
        return [
            'id' => 'walkin',
            'label' => (string) (WAIVER_PLAN_LABELS['walkin'] ?? 'Walk-in'),
            'redirect' => 'location.html?from=walkin#plans',
        ];
    }
    $plan = $park['plans'][$planId] ?? null;
    if (!$plan) {
        return null;
    }
    return [
        'id' => $planId,
        'label' => (string) ($plan['label'] ?? (WAIVER_PLAN_LABELS[$planId] ?? $planId)),
        'redirect' => (string) ($plan['redirect'] ?? ''),
    ];
}
