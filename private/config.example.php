<?php
// Copy to config.php. Keep this file and private/data outside the public web root.
return [
    'password_hash' => '',   // php -r 'echo password_hash("your-long-password", PASSWORD_DEFAULT), PHP_EOL;'
    'higgsfield_key' => '',
    'elevenlabs_key' => '',
    'fal_key' => '',
    'data_dir' => __DIR__ . '/data',
    'public_base_url' => 'https://video.example.com:4343', // exact origin users and providers reach
    'allow_local_http' => false,                           // true only for http://127.0.0.1:4343 testing
    'render_backend' => 'linux',
    // How Seedance should be told to say words it gets wrong (written into the spoken line; captions keep the real spelling).
    'respell' => ['San Ramon' => 'San Rah-moan'],
    'narration_speed' => 0.9,                               // ElevenLabs speed for 30-second previews (0.7–1.2); slower fills more of the video
    'voice_reference_url' => '',                            // optional: public https MP3/WAV of the spokesperson voice (10–20 s), sent to Seedance so every video uses it
    'ffmpeg_path' => '/usr/bin/ffmpeg',
    // Optional local speech recognition (whisper.cpp) so captions follow the exact words she says; free, no API.
    // Leave empty to time captions from pauses only.
    'whisper_cli' => '',                                    // e.g. /home/mark/.local/bin/whisper-cli
    'whisper_model' => '',                                  // e.g. /home/mark/.claude-video-vision/models/ggml-large-v3.bin
    'whisper_threads' => 4,
    'source' => 'https://www.mygoldenauto.net',
];
