# Ubuntu Desktop local dashboard — port 4343

This version runs the PHP dashboard and Linux caption worker inside your VMware Ubuntu VM. No Windows rendering agent or SiteGround connection is needed. The DealerCenter browser collector remains unfinished; use the ZIP importer while its live controls are being verified.

## Extract and configure

Extract this package into ~/golden-auto. Expected project directory: ~/golden-auto/golden-auto-video-agent. For an existing Ubuntu copy, back up its private/config.php and private/data first, and preserve its public/assets. No need to replace those folders with sample files.

In Ubuntu Terminal:

```bash
cd ~/golden-auto/golden-auto-video-agent
cp -n private/config.ubuntu.example.php private/config.php
nano private/config.php
```

Set password_hash and your complete Higgsfield API key. Keep data_dir private. If config.php already exists, the copy above does not replace it; set public_base_url to http://127.0.0.1:4343, allow_local_http to true, render_backend to linux, and ffmpeg_path to the path returned by command -v ffmpeg. Keep the current password hash and API key.

Generate a password hash without placing the password in shell history:

```bash
read -s -p "Dashboard password: " GA_PASSWORD; echo
printf '%s' "$GA_PASSWORD" | php -r 'echo password_hash(stream_get_contents(STDIN), PASSWORD_DEFAULT), PHP_EOL;'
unset GA_PASSWORD
```

Paste the hash into config.php using single quotes.

## Start the dashboard

```bash
cd ~/golden-auto/golden-auto-video-agent
bash ubuntu/start-dashboard.sh
```

Leave that terminal open. Open http://127.0.0.1:4343/ in Ubuntu’s browser and sign in. The built-in PHP server is for this private setup/test; use a proper HTTPS web server for a later public deployment. Binding to loopback deliberately keeps login off the unencrypted VM network.

To access it from Windows, open a separate PowerShell SSH tunnel:

```powershell
ssh -L 4343:127.0.0.1:4343 mark@YOUR_VM_IP
```

Keep that SSH session open, then open http://127.0.0.1:4343/ in Windows Chrome. If Windows port 4343 is already occupied, close the conflicting program first.

## Photos and generation

Import your DealerCenter ZIP and current vehicle details. Copy spokesperson.png into public/assets. Its URL is http://127.0.0.1:4343/assets/spokesperson.png. Asset sheets and photos automatically use port 4343. The dashboard reads local reference bytes and uploads them to Higgsfield storage, so Higgsfield does not need access to the VM or its private address. All Higgsfield API/storage traffic still uses HTTPS.

Existing SiteGround data is not automatically transferred. If migrating your private database and assets, old URLs inside imported vehicle records still point to SiteGround; the simplest first test is reimporting the vehicle ZIP on Ubuntu. Back up all old data before migration.

## Start the caption worker

Open another Ubuntu terminal or SSH session:

```bash
cd ~/golden-auto/golden-auto-video-agent
bash ubuntu/start-caption-worker.sh
```

Review captions and queue a render in the dashboard. It will process on Ubuntu and save the captioned MP4 under public/assets, with transparent caption backgrounds. A queued job uses the configured Linux backend. Old Windows jobs should be requeued after their active lease expires or finishes; they are not claimed by the Linux worker.

Both launchers run in the foreground for the first test. Ctrl+C stops them. An automatic service setup can follow after we verify the VM workflow. Caption timing still needs review; captions are drafted from the script, not transcribed audio. This configuration has been checked locally but still needs your Ubuntu VM test.
