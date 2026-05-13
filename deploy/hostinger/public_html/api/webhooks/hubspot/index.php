<?php

declare(strict_types=1);

/**
 * Hostinger-compatible HubSpot webhook ingress for Jarvis.
 *
 * Deploy path:
 *   public_html/api/webhooks/hubspot/index.php
 *
 * Config path:
 *   put jarvis-hostinger-config.php outside public_html when possible,
 *   for example /home/<account>/jarvis-hostinger-config.php.
 */

const HUBSPOT_TIMESTAMP_TOLERANCE_MS = 300000;

function respond(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function load_config(): array
{
    $candidatePaths = [
        dirname(__DIR__, 5) . '/jarvis-hostinger-config.php',
        dirname(__DIR__, 4) . '/jarvis-hostinger-config.php',
        __DIR__ . '/jarvis-hostinger-config.php',
    ];

    foreach ($candidatePaths as $path) {
        if (is_file($path)) {
            $config = require $path;

            if (is_array($config)) {
                return $config;
            }
        }
    }

    return [
        'supabase_url' => getenv('SUPABASE_URL') ?: '',
        'supabase_service_role_key' => getenv('SUPABASE_SERVICE_ROLE_KEY') ?: '',
        'hubspot_client_secret' => getenv('HUBSPOT_CLIENT_SECRET') ?: '',
        'public_base_url' => getenv('JARVIS_PUBLIC_BASE_URL') ?: '',
    ];
}

function get_header_value(string $name): ?string
{
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    $value = $_SERVER[$serverKey] ?? null;

    if (!is_string($value) || trim($value) === '') {
        return null;
    }

    return trim($value);
}

function decode_hubspot_signature_uri(string $requestUri): string
{
    return str_ireplace(
        ['%3A', '%2F', '%3F', '%40', '%21', '%24', '%27', '%28', '%29', '%2A', '%2C', '%3B'],
        [':', '/', '?', '@', '!', '$', "'", '(', ')', '*', ',', ';'],
        $requestUri,
    );
}

function request_uri_for_signature(array $config): string
{
    $requestUri = $_SERVER['REQUEST_URI'] ?? '/api/webhooks/hubspot';
    $configuredBaseUrl = rtrim((string) ($config['public_base_url'] ?? ''), '/');

    if ($configuredBaseUrl !== '') {
        return $configuredBaseUrl . $requestUri;
    }

    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';

    return $scheme . '://' . $host . $requestUri;
}

function verify_hubspot_signature(array $config, string $method, string $requestUri, string $rawBody): bool
{
    $secret = (string) ($config['hubspot_client_secret'] ?? '');

    if ($secret === '') {
        return false;
    }

    $signatureV3 = get_header_value('X-HubSpot-Signature-v3');
    $timestamp = get_header_value('X-HubSpot-Request-Timestamp');

    if ($signatureV3 !== null && $timestamp !== null) {
        if (!ctype_digit($timestamp)) {
            return false;
        }

        $timestampMs = (int) $timestamp;
        $nowMs = (int) floor(microtime(true) * 1000);

        if (abs($nowMs - $timestampMs) > HUBSPOT_TIMESTAMP_TOLERANCE_MS) {
            return false;
        }

        $source = strtoupper($method) . decode_hubspot_signature_uri($requestUri) . $rawBody . $timestamp;
        $expectedBase64 = base64_encode(hash_hmac('sha256', $source, $secret, true));
        $expectedHex = hash_hmac('sha256', $source, $secret);

        return hash_equals($expectedBase64, $signatureV3) || hash_equals($expectedHex, $signatureV3);
    }

    $legacySignature = get_header_value('X-HubSpot-Signature');

    if ($legacySignature === null) {
        return false;
    }

    $version = get_header_value('X-HubSpot-Signature-Version');
    $legacySource = $version === 'v2'
        ? $secret . strtoupper($method) . decode_hubspot_signature_uri($requestUri) . $rawBody
        : $secret . $rawBody;
    $expectedLegacySignature = hash('sha256', $legacySource);

    return hash_equals($expectedLegacySignature, $legacySignature);
}

function read_string(array $payload, string $key): ?string
{
    if (!array_key_exists($key, $payload)) {
        return null;
    }

    $value = $payload[$key];

    if (is_string($value) && trim($value) !== '') {
        return trim($value);
    }

    if ((is_int($value) || is_float($value)) && is_finite((float) $value)) {
        return (string) $value;
    }

    return null;
}

function read_number(array $payload, string $key): ?int
{
    if (!array_key_exists($key, $payload)) {
        return null;
    }

    $value = $payload[$key];

    if (is_int($value)) {
        return $value;
    }

    if (is_float($value) && is_finite($value)) {
        return (int) $value;
    }

    if (is_string($value) && trim($value) !== '' && is_numeric($value)) {
        return (int) $value;
    }

    return null;
}

function read_boolean(array $payload, string $key): ?bool
{
    return array_key_exists($key, $payload) && is_bool($payload[$key]) ? $payload[$key] : null;
}

function read_string_array(array $payload, string $key): array
{
    if (!array_key_exists($key, $payload) || !is_array($payload[$key])) {
        return [];
    }

    $items = [];

    foreach ($payload[$key] as $item) {
        if ((is_string($item) || is_int($item) || is_float($item)) && trim((string) $item) !== '') {
            $items[] = (string) $item;
        }
    }

    return $items;
}

function normalize_timestamp(string|int|float|null $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }

    if (is_int($value) || is_float($value) || preg_match('/^\d+$/', (string) $value) === 1) {
        $timestampMs = (int) $value;
        $seconds = intdiv($timestampMs, 1000);
        $milliseconds = $timestampMs % 1000;

        return gmdate('Y-m-d\TH:i:s', $seconds) . sprintf('.%03dZ', $milliseconds);
    } else {
        $parsed = strtotime((string) $value);

        if ($parsed === false) {
            return null;
        }

        $timestamp = (float) $parsed;
    }

    return gmdate('Y-m-d\TH:i:s.v\Z', (int) $timestamp);
}

function stable_json(mixed $value): string
{
    if (is_array($value)) {
        $keys = array_keys($value);
        $isList = $keys === range(0, count($value) - 1);

        if ($isList) {
            return '[' . implode(',', array_map('stable_json', $value)) . ']';
        }

        sort($keys, SORT_STRING);
        $parts = [];

        foreach ($keys as $key) {
            $parts[] = json_encode((string) $key, JSON_UNESCAPED_SLASHES) . ':' . stable_json($value[$key]);
        }

        return '{' . implode(',', $parts) . '}';
    }

    return json_encode($value, JSON_UNESCAPED_SLASHES);
}

function normalize_event(array $payload): ?array
{
    $portalId = read_string($payload, 'portalId');
    $subscriptionType = read_string($payload, 'subscriptionType') ?? read_string($payload, 'eventType');

    if ($portalId === null || $subscriptionType === null) {
        return null;
    }

    $occurredRaw = read_string($payload, 'occurredAt') ?? read_string($payload, 'label');
    $event = [
        'appId' => read_string($payload, 'appId'),
        'portalId' => $portalId,
        'subscriptionId' => read_string($payload, 'subscriptionId'),
        'subscriptionType' => $subscriptionType,
        'objectTypeId' => read_string($payload, 'objectTypeId'),
        'objectId' => read_string($payload, 'objectId'),
        'propertyName' => read_string($payload, 'propertyName'),
        'propertyValue' => read_string($payload, 'propertyValue'),
        'occurredAt' => normalize_timestamp($occurredRaw),
        'attemptNumber' => read_number($payload, 'attemptNumber'),
        'eventId' => read_string($payload, 'eventId'),
        'changeSource' => read_string($payload, 'changeSource'),
        'sourceId' => read_string($payload, 'sourceId'),
        'association' => [
            'fromObjectId' => read_string($payload, 'fromObjectId'),
            'fromObjectTypeId' => read_string($payload, 'fromObjectTypeId'),
            'toObjectId' => read_string($payload, 'toObjectId'),
            'toObjectTypeId' => read_string($payload, 'toObjectTypeId'),
            'associationTypeId' => read_string($payload, 'associationTypeId'),
            'associationCategory' => read_string($payload, 'associationCategory'),
            'associationRemoved' => read_boolean($payload, 'associationRemoved'),
            'isPrimaryAssociation' => read_boolean($payload, 'isPrimaryAssociation'),
        ],
        'merge' => [
            'primaryObjectId' => read_string($payload, 'primaryObjectId'),
            'mergedObjectIds' => read_string_array($payload, 'mergedObjectIds'),
            'newObjectId' => read_string($payload, 'newObjectId'),
        ],
        'payload' => $payload,
    ];

    $fingerprintSource = [
        'appId' => $event['appId'],
        'portalId' => $event['portalId'],
        'subscriptionId' => $event['subscriptionId'],
        'subscriptionType' => $event['subscriptionType'],
        'objectTypeId' => $event['objectTypeId'],
        'objectId' => $event['objectId'],
        'propertyName' => $event['propertyName'],
        'propertyValue' => $event['propertyValue'],
        'occurredAt' => $event['occurredAt'],
        'association' => $event['association'],
        'merge' => $event['merge'],
    ];

    $event['eventFingerprint'] = hash('sha256', stable_json($fingerprintSource));

    return $event;
}

function parse_events(mixed $payload): array
{
    if (!is_array($payload)) {
        return [];
    }

    $eventPayloads = array_is_list($payload) ? $payload : [$payload];
    $events = [];

    foreach ($eventPayloads as $eventPayload) {
        if (is_array($eventPayload)) {
            $event = normalize_event($eventPayload);

            if ($event !== null) {
                $events[] = $event;
            }
        }
    }

    return $events;
}

function supabase_request(array $config, string $method, string $path, ?array $body = null): array
{
    $baseUrl = rtrim((string) $config['supabase_url'], '/');
    $serviceRoleKey = (string) $config['supabase_service_role_key'];

    if ($baseUrl === '' || $serviceRoleKey === '') {
        throw new RuntimeException('Configuration Supabase manquante.');
    }

    $curl = curl_init($baseUrl . $path);
    $headers = [
        'apikey: ' . $serviceRoleKey,
        'Authorization: Bearer ' . $serviceRoleKey,
        'Content-Type: application/json',
        'Accept: application/json',
    ];

    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 8,
    ]);

    if ($body !== null) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES));
    }

    $rawResponse = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_close($curl);

    if ($rawResponse === false || $error !== '') {
        throw new RuntimeException('Erreur HTTP Supabase: ' . $error);
    }

    if ($status < 200 || $status >= 300) {
        throw new RuntimeException('Erreur Supabase ' . $status . ': ' . $rawResponse);
    }

    $decoded = json_decode($rawResponse, true);

    return is_array($decoded) ? $decoded : [];
}

function load_org_ids_by_portal_id(array $config, array $portalIds): array
{
    $portalIds = array_values(array_unique(array_filter($portalIds, static fn ($id) => is_string($id) && $id !== '')));

    if ($portalIds === []) {
        return [];
    }

    $quotedIds = array_map(static fn ($id) => '"' . str_replace('"', '\"', $id) . '"', $portalIds);
    $path = '/rest/v1/organizations?select=id,hubspot_portal_id&hubspot_portal_id=in.(' . implode(',', $quotedIds) . ')';
    $rows = supabase_request($config, 'GET', $path);
    $map = [];

    foreach ($rows as $row) {
        if (isset($row['id'], $row['hubspot_portal_id'])) {
            $map[(string) $row['hubspot_portal_id']] = (string) $row['id'];
        }
    }

    return $map;
}

function persist_events(array $config, array $events): array
{
    if ($events === []) {
        return ['inserted' => [], 'duplicate' => 0];
    }

    $orgByPortalId = load_org_ids_by_portal_id($config, array_map(static fn ($event) => $event['portalId'], $events));
    $rows = [];

    foreach ($events as $event) {
        $orgId = $orgByPortalId[$event['portalId']] ?? null;

        $rows[] = [
            'org_id' => $orgId,
            'portal_id' => $event['portalId'],
            'app_id' => $event['appId'],
            'subscription_id' => $event['subscriptionId'],
            'subscription_type' => $event['subscriptionType'],
            'event_id' => $event['eventId'],
            'event_fingerprint' => $event['eventFingerprint'],
            'object_type_id' => $event['objectTypeId'],
            'object_id' => $event['objectId'],
            'property_name' => $event['propertyName'],
            'property_value' => $event['propertyValue'],
            'occurred_at' => $event['occurredAt'],
            'attempt_number' => $event['attemptNumber'],
            'payload' => $event['payload'],
            'processing_status' => $orgId !== null ? 'queued' : 'ignored',
            'error_message' => $orgId !== null ? null : 'Portal HubSpot non relie a une organisation Jarvis.',
        ];
    }

    $path = '/rest/v1/hubspot_webhook_events'
        . '?on_conflict=event_fingerprint'
        . '&select=id,org_id,event_fingerprint,processing_status';

    $baseUrl = rtrim((string) $config['supabase_url'], '/');
    $serviceRoleKey = (string) $config['supabase_service_role_key'];
    $curl = curl_init($baseUrl . $path);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . $serviceRoleKey,
            'Authorization: Bearer ' . $serviceRoleKey,
            'Content-Type: application/json',
            'Accept: application/json',
            'Prefer: resolution=ignore-duplicates,return=representation',
        ],
        CURLOPT_POSTFIELDS => json_encode($rows, JSON_UNESCAPED_SLASHES),
        CURLOPT_TIMEOUT => 8,
    ]);

    $rawResponse = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_close($curl);

    if ($rawResponse === false || $error !== '') {
        throw new RuntimeException('Erreur HTTP Supabase: ' . $error);
    }

    if ($status < 200 || $status >= 300) {
        throw new RuntimeException('Erreur Supabase ' . $status . ': ' . $rawResponse);
    }

    $inserted = json_decode($rawResponse, true);
    $inserted = is_array($inserted) ? $inserted : [];

    return [
        'inserted' => $inserted,
        'duplicate' => max(0, count($rows) - count($inserted)),
    ];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['success' => false, 'error' => 'Method not allowed']);
}

$config = load_config();
$rawBody = file_get_contents('php://input') ?: '';
$requestUri = request_uri_for_signature($config);

if (!verify_hubspot_signature($config, $_SERVER['REQUEST_METHOD'], $requestUri, $rawBody)) {
    respond(401, ['success' => false, 'error' => 'Signature HubSpot invalide']);
}

$decodedBody = json_decode($rawBody, true);

if ($decodedBody === null && json_last_error() !== JSON_ERROR_NONE) {
    respond(400, ['success' => false, 'error' => 'JSON invalide']);
}

try {
    $events = parse_events($decodedBody);
    $result = persist_events($config, $events);
    $accepted = 0;

    foreach ($result['inserted'] as $inserted) {
        if (($inserted['org_id'] ?? null) !== null && ($inserted['processing_status'] ?? null) === 'queued') {
            $accepted++;
        }
    }

    respond(200, [
        'success' => true,
        'data' => [
            'accepted' => $accepted,
            'duplicate' => $result['duplicate'],
        ],
    ]);
} catch (Throwable $error) {
    error_log('[jarvis-hubspot-webhook] ' . $error->getMessage());
    respond(500, ['success' => false, 'error' => 'Erreur interne webhook']);
}
