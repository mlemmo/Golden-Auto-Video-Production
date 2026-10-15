<?php
declare(strict_types=1);
$private=is_file(__DIR__.'/../private/app.php')?__DIR__.'/../private':dirname(__DIR__,2).'/golden-auto-video-private';
require $private.'/app.php';
$path=$private.'/config.php';
if (!is_file($path)) {http_response_code(503);exit('Setup required: copy private/config.example.php to private/config.php, set a password hash and Higgsfield API key. Keep private outside the web document root.');}
$cfg=require $path;
$cfg['asset_dir']=__DIR__.'/assets';
if (empty($cfg['password_hash'])) {http_response_code(503);exit('Set the private dashboard password hash before use.');}
$isHttps=isset($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off';
if (!$isHttps && !in_array($_SERVER['REMOTE_ADDR']??'', ['127.0.0.1','::1'],true)) {http_response_code(403);exit('Use HTTPS to access this dashboard.');}
header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');header('Referrer-Policy: no-referrer');
session_set_cookie_params(['httponly'=>true,'secure'=>$isHttps,'samesite'=>'Strict']);session_start();
$_SESSION['csrf']??=bin2hex(random_bytes(24));
function esc(mixed $s): string {return htmlspecialchars((string)$s,ENT_QUOTES,'UTF-8');}
$loginError='';
if (isset($_POST['password'])) {
    if (!hash_equals($_SESSION['csrf'],(string)($_POST['csrf']??''))) {http_response_code(403);exit('Invalid request.');}
    $_SESSION['attempts']??=[];$_SESSION['attempts']=array_values(array_filter($_SESSION['attempts'],fn($t)=>$t>time()-300));
    if(count($_SESSION['attempts'])>=5) $loginError='Too many attempts. Wait five minutes.';
    elseif(password_verify((string)$_POST['password'],$cfg['password_hash'])) {session_regenerate_id(true);$_SESSION['auth']=true;$_SESSION['attempts']=[];}
    else {$_SESSION['attempts'][]=time();$loginError='Incorrect password.';}
}
if (!($_SESSION['auth']??false)) { ?>
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Golden Auto • Sign in</title><link rel="stylesheet" href="style.css"></head><body><main class="login"><span class="eyebrow">GOLDEN AUTO</span><h1>Video Studio</h1><p>Private inventory video dashboard.</p><form method="post"><input type="hidden" name="csrf" value="<?=esc($_SESSION['csrf'])?>"><label>Dashboard password<input type="password" name="password" required autocomplete="current-password"></label><button>Sign in</button><p><?=esc($loginError)?></p></form></main></body></html>
<?php exit; }
$db=db($cfg);
if (isset($_GET['api'])) {
    header('Content-Type: application/json');
    try {
        if ($_SERVER['REQUEST_METHOD']!=='POST') throw new RuntimeException('POST required.');
        if (!hash_equals($_SESSION['csrf'],$_SERVER['HTTP_X_CSRF_TOKEN']??'')) {http_response_code(403);throw new RuntimeException('Invalid request.');}
        $action=$_GET['api'];
        $in=in_array($action,['import','spokesperson_upload'],true)?$_POST:json_decode(file_get_contents('php://input'),true,512,JSON_THROW_ON_ERROR);
        require_once $private.'/spokespersons.php';
        // Golden Auto narration-first add-on
        if(str_starts_with($action,'narration_')){require_once $private.'/narrations.php';echo json_encode(narrationApi($action,$in,$cfg,$db),JSON_THROW_ON_ERROR);exit;}
        if(str_starts_with($action,'spokesperson_')){echo json_encode(spokespersonApi($action,$in,$cfg,$db),JSON_THROW_ON_ERROR);exit;}
        if ($action==='import') {
            $file=$_FILES['media']??null;if(!$file||$file['error']!==UPLOAD_ERR_OK||!is_uploaded_file($file['tmp_name']))throw new RuntimeException('Upload failed. Check upload_max_filesize and post_max_size in PHP settings.');
            $v=importMediaZip($file['tmp_name'],$in,$cfg);$a=state($db,'inventory')??['vehicles'=>[]];
            $a['vehicles']=array_values(array_filter($a['vehicles'],fn($c)=>$c['StockNumber']!==$v['StockNumber']));$a['vehicles'][]=$v;save($db,'inventory',$a);save($db,'import:'.$v['StockNumber'],$v);
            try{$sheet=assetSheet($v,$cfg);save($db,'sheet:'.$v['Vin'],$sheet);}catch(Throwable $e){$v['sheet_error']=$e->getMessage();}
            echo json_encode(['vehicles'=>$a['vehicles'],'imported'=>$v],JSON_THROW_ON_ERROR);exit;
        }
        if ($action==='logout') {$_SESSION=[];session_destroy();echo '{}';exit;}
        if ($action==='inventory') {$a=state($db,'inventory')??['vehicles'=>[]];echo json_encode($a,JSON_THROW_ON_ERROR);exit;}
        if ($action==='sync_log') {echo json_encode(state($db,'sync_log')??['entries'=>[]],JSON_THROW_ON_ERROR);exit;}
        if ($action==='sync') {
            $list=inventory($cfg['source']);$old=state($db,'inventory')??[];$stocks=array_column($list,'StockNumber');foreach($old['vehicles']??[]as $v)if(($v['source']??'')==='zip'&&!in_array($v['StockNumber'],$stocks,true))$list[]=$v;save($db,'inventory',['vehicles'=>$list,'checked_at'=>gmdate('c')]);
            echo json_encode(['vehicles'=>$list,'checked_at'=>gmdate('c')],JSON_THROW_ON_ERROR);exit;
        }
        if ($action==='detail') {
            $a=state($db,'inventory')??[];$found=false;
            foreach ($a['vehicles']??[] as &$v) if ($v['StockNumber']===($in['stock']??'')) {$v=enrich($v);$out=$v;$found=true;break;}
            if (!$found) throw new RuntimeException('Vehicle not found. Refresh inventory first.');
            save($db,'inventory',$a);$out['script']=script($out);$out['scripts']=['15'=>$out['script'],'30'=>script($out,30)];
            $existing=state($db,'sheet:'.$out['Vin']);
            if($existing && ($existing['gallery_hash']??'')===hash('sha256',json_encode($out['photos']))) $out['asset_sheet']=$existing;
            else try{$out['asset_sheet']=assetSheet($out,$cfg);save($db,'sheet:'.$out['Vin'],$out['asset_sheet']);}catch(Throwable $e){$out['sheet_error']=$e->getMessage();}echo json_encode($out,JSON_THROW_ON_ERROR);exit;
        }
        if ($action==='sheet') {
            $a=state($db,'inventory')??[];$v=null;foreach($a['vehicles']??[] as $c)if($c['StockNumber']===($in['stock']??''))$v=$c;
            if(!$v)throw new RuntimeException('Select a current vehicle first.');
            $v=enrich($v);$selected=$in['photos']??[];if(!is_array($selected))throw new RuntimeException('Invalid photo selection.');
            $sheet=assetSheet($v,$cfg,$selected);save($db,'sheet:'.$v['Vin'],$sheet);echo json_encode($sheet,JSON_THROW_ON_ERROR);exit;
        }
        if ($action==='speech') {echo json_encode(['speech'=>speechScript((string)($in['script']??'')),'words'=>speechWordCount((string)($in['script']??''))]);exit;}
        if ($action==='caption_draft'||$action==='finish') {
            $q=$db->prepare('SELECT payload FROM jobs WHERE id=?');$q->execute([$in['id']??'']);$raw=$q->fetchColumn();if(!$raw)throw new RuntimeException('Job not found.');$job=json_decode($raw,true);
            if($job['status']!=='completed'||empty($job['video_url']))throw new RuntimeException('Wait for the video generation to complete.');
            if(($job['provider']??'')==='fal_lipsync'){
                require_once $private.'/finishing.php';
                if($action==='caption_draft'){
                    if(in_array($job['finish_status']??'',['queued','rendering'],true))throw new RuntimeException('Wait for the current finishing job before preparing a new draft.');
                    echo json_encode(goldenFinishDraft($db,$cfg,$job),JSON_THROW_ON_ERROR);exit;
                }
                if(empty($job['finishing_plan']))throw new RuntimeException('Open Review captions first to prepare the intro and closing card.');
            }
            if($action==='caption_draft'){echo json_encode(['srt'=>captionDraft($job['script'],(float)($job['duration']??15),(string)($job['vehicle']??'')),'note'=>'Draft timing from the script. Review against the actual spoken audio before rendering.']);exit;}
            if(!($in['reviewed']??false))throw new RuntimeException('Review caption wording and timing first.');
            if(in_array($job['finish_status']??'',['queued','rendering'],true))throw new RuntimeException('This video is already queued for finishing.');
            $job['captions_srt']=validateSrt((string)($in['srt']??''),(float)($job['duration']??15));$job['finish_status']='queued';$job['render_backend']=$cfg['render_backend']??'linux';$job['finish_error']='';$job['captioned_url']=null;
            $q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($job),$job['id']]);echo json_encode(['message'=>'Caption render queued. The configured rendering worker will process it. Refresh video jobs to check progress.']);exit;
        }
        if ($action==='references') {
            $sheet=referenceImageUrl(trim((string)($in['sheet']??'')),$cfg);$avatar=referenceImageUrl(spokespersonFind($db,$cfg,(string)($in['spokesperson']??''))['url'],$cfg);
            uploadReference($sheet,$cfg);uploadReference($avatar,$cfg);
            echo json_encode(['message'=>'Both references uploaded successfully to Higgsfield. No video generation was submitted.']);exit;
        }
        if ($action==='jobs') {echo json_encode($db->query('SELECT payload FROM jobs ORDER BY rowid DESC LIMIT 30')->fetchAll(PDO::FETCH_COLUMN));exit;}
        if ($action==='poll') {
            $q=$db->prepare('SELECT payload FROM jobs WHERE id=?');$q->execute([$in['id']??'']);$raw=$q->fetchColumn();
            if (!$raw) throw new RuntimeException('Job not found.');$job=json_decode($raw,true);
            if (empty($job['request_id'])) throw new RuntimeException('Submission uncertain. Check Higgsfield request history before retrying.');
            if (!in_array($job['status'],['completed','canceled'],true)) {
                $result=json_decode(request('https://api.higgsfield.ai/requests/'.rawurlencode($job['request_id']).'/status',null,$cfg['higgsfield_key']),true,512,JSON_THROW_ON_ERROR);
                $job['status']=$result['status']??'unknown';$job['video_url']=$result['video']['url']??null;$job['error']=jobError($result['error']??$result['detail']??null);
                $q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($job),$job['id']]);
            }
            echo json_encode($job,JSON_THROW_ON_ERROR);exit;
        }
        if ($action==='generate') {
            if (empty($cfg['higgsfield_key'])) throw new RuntimeException('Add your Higgsfield API key to private/config.php first.');
            if (!($in['approve_spend']??false)) throw new RuntimeException('Confirm this paid generation.');
            $a=state($db,'inventory')??[];$v=null;
            foreach ($a['vehicles']??[] as $candidate) if ($candidate['StockNumber']===($in['stock']??'')) $v=$candidate;
            if (!$v) throw new RuntimeException('Select a current vehicle first.');
            if(($v['active']??true)===false) throw new RuntimeException('This vehicle is no longer in DealerCenter active inventory. Generation stopped.');
            if(($v['source']??'')==='zip'){
                if(!($in['confirm_current']??false))throw new RuntimeException('Confirm that imported availability and highest advertised price are still current.');$fresh=$v;
            }else{
                $current=inventory($cfg['source']);$fresh=null;
                foreach($current as $candidate)if($candidate['Vin']===$v['Vin'])$fresh=$candidate;
                if(!$fresh)throw new RuntimeException('Vehicle is no longer listed. Generation stopped.');$fresh=enrich($fresh);
            }
            if ($fresh['price']!==$v['price']) throw new RuntimeException('Vehicle price changed. Reload its details and review the script.');
            // voice=native: Seedance speaks the script itself (generate_audio). voice=narration: silent video,
            // voice added later from the approved ElevenLabs narration by lip-sync.
            $spoken=trim((string)($in['script']??''));
            $voice=(string)($in['voice']??'native');if(!in_array($voice,['native','narration'],true)) throw new RuntimeException('Choose how the voice is made.');
            $duration=(int)($in['duration']??15);if(!in_array($duration,[15,30],true)) throw new RuntimeException('Choose 15 or 30 seconds.');
            $style=(string)($in['style']??'dynamic');if(!in_array($style,['dynamic','showroom'],true)) throw new RuntimeException('Choose a video style.');
            if($style==='dynamic' && $duration!==15) throw new RuntimeException('The dynamic shot sequence is fixed at 15 seconds. Choose showroom for 30 seconds.');
            if($voice==='native' && $style!=='showroom') throw new RuntimeException('Spoken-in-video uses the showroom style. Choose showroom, or ElevenLabs narration for the dynamic sequence.');
            if($voice==='native' && $spoken==='') throw new RuntimeException('Write the script the spokesperson will say.');
            $sheetUrl=trim((string)($in['sheet']??''));
            $savedSheet=state($db,'sheet:'.$v['Vin']);
            if($savedSheet && (!$sheetUrl || $sheetUrl===$savedSheet['url'])){if($savedSheet['gallery_hash']!==hash('sha256',json_encode($fresh['photos'])))throw new RuntimeException('Vehicle photos changed. Reopen the vehicle to rebuild its asset sheet.');$sheetUrl=$savedSheet['url'];}
            $presenter=spokespersonFind($db,$cfg,(string)($in['spokesperson']??''));
            $sheet=referenceImageUrl($sheetUrl,$cfg);$avatar=referenceImageUrl($presenter['url'],$cfg);
            $formats=['instagram_reels'=>'9:16','facebook_reels'=>'9:16','facebook_feed'=>'3:4','square'=>'1:1'];
            $format=(string)($in['format']??'');if(!isset($formats[$format])) throw new RuntimeException('Choose a video format.');
            $fingerprint=hash('sha256',json_encode([$v['Vin'],$v['price'],$spoken,$sheet,$avatar,$presenter['description'],$format,$style,$duration,$voice]));
            $id=bin2hex(random_bytes(12));$job=['id'=>$id,'stock'=>$v['StockNumber'],'vehicle'=>title($v),'spokesperson_id'=>$presenter['id'],'spokesperson'=>$presenter['name'],'format'=>$format,'style'=>$style,'duration'=>$duration,'status'=>'preparing_references','created_at'=>gmdate('c'),'script'=>$spoken,'speech_script'=>$voice==='native'?nativeSpeech($spoken):speechScript($spoken),'price'=>$v['price'],'voice'=>$voice];
            // Native voice: one approval builds the final video (captions timed from the video's own audio).
            if($voice==='native')$job['auto_build']=true;
            $db->beginTransaction();
            try{
                $q=$db->prepare('SELECT id,payload FROM jobs WHERE fingerprint=?');$q->execute([$fingerprint]);$previous=$q->fetch(PDO::FETCH_ASSOC);
                if($previous){$prior=json_decode($previous['payload'],true);if(!in_array($prior['status']??'',['failed','canceled'],true))throw new RuntimeException('This exact request already exists. Check its status before generating again.');$q=$db->prepare('UPDATE jobs SET fingerprint=NULL WHERE id=?');$q->execute([$previous['id']]);}
                $q=$db->prepare('INSERT INTO jobs VALUES (?,?,?)');$q->execute([$id,$fingerprint,json_encode($job)]);$db->commit();
            }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}

            try{$hostedSheet=uploadReference($sheet,$cfg);$hostedAvatar=uploadReference($avatar,$cfg);}
            catch(Throwable $e){$job['status']='reference_upload_failed';$job['error']=jobError($e->getMessage());$q=$db->prepare('UPDATE jobs SET fingerprint=NULL,payload=? WHERE id=?');$q->execute([json_encode($job),$id]);throw new RuntimeException($job['error']);}
            $job['status']='submitting';$q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($job),$id]);
            $native=$voice==='native';
            $payload=['prompt'=>$native?promptNative($fresh,nativeSpeech($spoken),$duration,$presenter['description']):prompt($fresh,$spoken,$style,$duration,$presenter['description']),'image_urls'=>[$hostedSheet,$hostedAvatar],'duration'=>$duration,'resolution'=>'720p','aspect_ratio'=>$formats[$format],'output_format'=>'mp4','generate_audio'=>$native];
            try {
                $r=json_decode(request('https://api.higgsfield.ai/bytedance/seedance-2.5/reference-to-video',$payload,$cfg['higgsfield_key']),true,512,JSON_THROW_ON_ERROR);
                if(empty($r['request_id'])) throw new RuntimeException('Missing request ID.');
                $job['request_id']=$r['request_id'];$job['status']=$r['status']??'queued';$job['error']=jobError($r['error']??$r['detail']??null);
            } catch(Throwable $e) {$job['status']='submission_uncertain';$q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($job),$id]);throw new RuntimeException('Submission could not be confirmed. Check Higgsfield history; do not retry automatically.');}
            $q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($job),$id]);echo json_encode($job);exit;
        }
        throw new RuntimeException('Unknown action.');
    } catch(Throwable $e) {if(http_response_code()===200)http_response_code(400);echo json_encode(['error'=>$e->getMessage()]);exit;}
}
?>
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Golden Auto • Video Studio</title><link rel="stylesheet" href="style.css?v=3"></head><body>
<header><div><span class="eyebrow">GOLDEN AUTO / SAN RAMON</span><h1>Inventory → video</h1><p>Your cars. Your spokespersons. Ready for social.</p></div><button class="secondary" id="logout">Sign out</button></header>
<main><details class="import-panel" open><summary>Import DealerCenter media ZIP — works without website access</summary><form id="importForm"><div class="import-grid"><label>Stock number<input name="stock" value="870288" required></label><label>Year<input name="year" type="number" required min="1900" max="2100"></label><label>Make<input name="make" required></label><label>Model<input name="model" required></label><label>Trim<input name="trim"></label><label>VIN (optional)<input name="vin"></label><label>Mileage (optional)<input name="mileage" type="number" min="0"></label><label>Advertised prices (highest used)<input name="prices" placeholder="14550; 14688.25"></label></div><label>Vehicle description<textarea name="description" rows="3"></textarea></label><label>DealerCenter media ZIP<input name="media" type="file" accept=".zip" required></label><p class="hint">Enter current listing facts. ZIP photos alone do not supply pricing or availability. Maximum 50 MB; your host’s upload limit may be lower.</p><button id="importButton">Import vehicle and photos</button></form></details>
<details class="import-panel" id="spokespersonPanel"><summary>Spokespersons — upload new spokesperson images and manage saved ones</summary><div id="spokespersonList" class="spokesperson-list"></div>
<form id="spokespersonForm"><div class="import-grid"><label>Name<input name="name" maxlength="60" required placeholder="e.g. Maya — showroom"></label><label>Image (JPG, PNG or WebP, at least 300×300)<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required></label></div><label>Description used in the video prompt<textarea name="description" rows="2" maxlength="300" required placeholder="trustworthy friendly adult man age 35–40, navy blazer over open-collar shirt"></textarea></label><p class="hint">Use a clear, well-lit, front-facing photo of one person from the waist up on a plain background. Describe what the image shows (apparent age, look, outfit) so the prompt matches the reference. Only upload people who have agreed to appear in your ads.</p><button id="spokespersonButton">Upload spokesperson</button></form></details>
<div class="toolbar"><div><h2>Choose a vehicle</h2><p id="syncTime">Refresh to load your current inventory.</p></div><button id="sync">Refresh inventory</button></div><details id="syncLogPanel" class="import-panel"><summary id="syncLogSummary">Inventory changes — no DealerCenter sync yet</summary><div id="syncLog"></div></details><p id="message" role="status"></p>
<div class="workspace"><section id="inventory" class="vehicle-list"></section><section class="editor"><span class="eyebrow">VEHICLE CAMPAIGN</span><h2 id="selected">Select a vehicle</h2><div id="facts"></div>
<label>Voice<select id="voice"><option value="native">Spoken in the video — Seedance voice, lips and gestures in one step (recommended)</option><option value="narration">ElevenLabs narration + lip-sync — separate approval steps</option></select></label><label>Video style<select id="style"><option value="showroom">Showroom walkaround — spokesperson walks the car and presents</option><option value="dynamic">Dynamic product sequence — tracking / interior / drone</option></select></label><label>Duration<select id="duration"><option value="30">30 seconds — detailed walkthrough</option><option value="15">15 seconds — short ad</option></select></label><label>Publish format<select id="format"><option value="instagram_reels">Instagram Reels — 9:16</option><option value="facebook_reels">Facebook Reels — 9:16</option><option value="facebook_feed">Facebook Feed — 4:5 (crop after generation)</option><option value="square">Instagram / Facebook Square — 1:1</option></select></label>
<p class="hint" id="formatHint">Vertical master. Check text and face placement before posting.</p>
<label><span id="scriptLabel">Script — the spokesperson says this in the video</span><textarea id="script" rows="5" maxlength="600" placeholder="Choose a vehicle to draft its script."></textarea></label><p class="hint" id="wordCount">Keep the script within the chosen duration.</p><details><summary>Actual narration text — prices written out</summary><p id="speechPreview"></p></details>
<details><summary>Website description</summary><p id="description"></p></details>
<div id="sheetPreview"></div><details><summary>Review or change inventory photos</summary><p class="hint">Default sheet: front, both sides and rear (4 photos, 2×2). Choose up to 9 photos to change it; avoid close-ups with text such as labels or stickers.</p><div id="photoPicker" class="photo-picker"></div><button id="rebuild" class="secondary" disabled>Rebuild asset sheet</button></details><label>Car asset sheet — automatically created; optional URL override<input id="sheet" type="url" placeholder="https://your-domain.com/car-asset-sheet.jpg"></label>
<label>Spokesperson<select id="spokesperson"><option value="">Loading spokespersons…</option></select></label>
<div id="spokespersonPreview" class="spokesperson-preview"></div><button type="button" class="secondary" id="manageSpokespersons">Upload or manage spokespersons</button>
<p class="hint">The selected image is reference image 2 and its description is written into the video prompt. Add or remove spokespersons in the Spokespersons panel above. Native voice consistency is not guaranteed across generations.</p>
<div class="beats" id="beats"><div><b>00–04</b><span>Low tracking hook</span></div><div><b>04–09</b><span>Interior macro glide</span></div><div><b>09–15</b><span>Drone pull-away + CTA</span></div></div>
<label class="check"><input type="checkbox" id="approve">I reviewed the vehicle facts and script and approve one paid Higgsfield generation at my account’s current rate.</label>
<label class="check"><input type="checkbox" id="confirmCurrent">For imported vehicles: I confirm the vehicle is available and its highest advertised price is current.</label><div class="actions"><button class="secondary" id="checkReferences">Check reference uploads</button><button id="generate" disabled>Generate video</button><button class="secondary" id="brief" disabled>Download production brief</button></div>
<p class="hint" id="voiceHint">Spoken in the video: Seedance 2.5 generates the spokesperson's voice, lip movement and gestures together from the script, and the captioned final video is built automatically after this one approval. Check the car details and the spoken words before using it.</p><p class="hint" id="narrationHint">ElevenLabs narration: Seedance 2.5 renders a silent video: in the walkaround the spokesperson walks along the near side of the car, talking to camera; dynamic style uses a presenter inset. The voice comes from the approved ElevenLabs narration, added by lip-sync below, which then builds the captioned final video automatically. Review identity and car details in the generated video before using it.</p>
</section></div><section><h2>Video jobs</h2><p class="hint">Refresh status to retrieve the generated master. Download completed files promptly; provider links can expire.</p><div id="jobs"></div><section id="captionEditor" hidden><h2>Review captions</h2><p class="hint">Automatic draft from the script—not a transcription. Check wording and timing against the generated audio. You can paste a corrected SRT here. Numeric prices stay numeric.</p><textarea id="captionSrt" rows="14"></textarea><label class="check"><input id="captionReviewed" type="checkbox">I checked the captions against the video.</label><button id="renderCaptions">Render captioned video</button></section></section><?php require $private.'/narration_panel.php'; ?></main>
<script>window.CSRF=<?=json_encode($_SESSION['csrf'])?>;</script><script src="app.js?v=7"></script><script src="narration.js?v=4"></script></body></html>
