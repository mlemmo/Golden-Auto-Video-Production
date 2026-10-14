<?php
return [
    'password_hash' => '', // Generate: php -r 'echo password_hash("your-long-password", PASSWORD_DEFAULT), PHP_EOL;'
    'higgsfield_key' => '', // Complete copied API key; never put it in public files.
    'data_dir' => __DIR__ . '/data',
    'public_base_url' => 'https://tnetg.com/golden-auto-video', // Planned deployment URL; change if installed elsewhere
    'source' => 'https://www.mygoldenauto.net',
];
