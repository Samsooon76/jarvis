<?php

declare(strict_types=1);

return [
    // Example: https://rthzfffhyyqateirubvf.supabase.co
    'supabase_url' => 'https://YOUR_PROJECT_REF.supabase.co',

    // Use the Supabase service-role key. Keep this file outside public_html.
    'supabase_service_role_key' => 'YOUR_SUPABASE_SERVICE_ROLE_KEY',

    // HubSpot app client secret, used to validate webhook signatures.
    'hubspot_client_secret' => 'YOUR_HUBSPOT_CLIENT_SECRET',

    // Exact public origin used in HubSpot Target URL, without trailing slash.
    // Example: https://api.your-domain.com
    'public_base_url' => 'https://api.your-domain.com',
];
