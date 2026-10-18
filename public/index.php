<?php
declare(strict_types=1);
$private=is_file(__DIR__.'/../private/app.php')?__DIR__.'/../private':dirname(__DIR__,2).'/golden-auto-video-private';
require $private.'/app.php';
$path=$private.'/config.php';
if (!is_file($path)) {http_response_code(503);exit('Setup required: copy private/config.example.php to private/config.php, set a password hash and Higgsfield API key. Keep private outside the web document root.');}
$cfg=require $path;
$cfg['asset_dir']=__DIR__.'/assets';
$env=$cfg['environment']??'';$staging=in_array($env,['staging','node'],true);  // staging / node test site: banner on every page
$envLabel=$env==='node'?'NODE TEST':'STAGING';
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
    elseif(password_verify((string)$_POST['password'],$cfg['password_hash'])) {session_regenerate_id(true);$_SESSION['auth']=true;$_SESSION['attempts']=[];
        // Post/Redirect/Get: reloading the dashboard then never asks the browser to resend the sign-in form.
        header('Location: '.strtok($_SERVER['REQUEST_URI']??'/','?'),true,303);exit;}
    else {$_SESSION['attempts'][]=time();$loginError='Incorrect password.';}
}
if (!($_SESSION['auth']??false)) {echo pageRender('login',['TITLE_PREFIX'=>$staging?$envLabel.' • ':'','CSRF'=>esc($_SESSION['csrf']),'ERROR'=>esc($loginError)]);exit; }
$db=db($cfg);
// Current client (dealer): its inventory, voice previews and videos are what the dashboard shows.
require_once $private.'/clients.php';
$clients=clientsLoad($db);$client=(string)($_SESSION['client']??CLIENT_DEFAULT);
if(!in_array($client,array_column($clients['items'],'id'),true))$client=CLIENT_DEFAULT;
$invKey=clientInventoryKey($client);
// Dealer named in scripts and speech for this client; its website is said as written in its details.
$dealer=clientDetails(clientFind($db,$client));
if($client!==CLIENT_DEFAULT)speechSites([$dealer['website']=>$dealer['website_spoken']]);
if (isset($_GET['api'])) {
    header('Content-Type: application/json');
    try {
        if ($_SERVER['REQUEST_METHOD']!=='POST') throw new RuntimeException('POST required.');
        if (!hash_equals($_SESSION['csrf'],$_SERVER['HTTP_X_CSRF_TOKEN']??'')) {http_response_code(403);throw new RuntimeException('Invalid request.');}
        $action=$_GET['api'];
        $in=in_array($action,['import','spokesperson_upload','footage_build'],true)?$_POST:json_decode(file_get_contents('php://input'),true,512,JSON_THROW_ON_ERROR);
        require_once $private.'/spokespersons.php';
        if(is_array($in))$in['client']=$client;
        if ($action==='clients') {echo json_encode(['items'=>array_map(fn($c)=>$c+['script_details'=>clientDetails($c)],$clients['items']),'current'=>$client],JSON_THROW_ON_ERROR);exit;}
        if ($action==='client_details') {$c=clientSaveDetails($db,$client,$in);echo json_encode(['client'=>$c+['script_details'=>clientDetails($c)]],JSON_THROW_ON_ERROR);exit;}
        if ($action==='client_select') {clientFind($db,(string)($in['id']??''));$_SESSION['client']=(string)$in['id'];echo json_encode(['message'=>'Client selected.']);exit;}
        if ($action==='client_add') {$c=clientAdd($db,(string)($in['name']??''),(string)($in['website']??''));$_SESSION['client']=$c['id'];echo json_encode(['client'=>$c],JSON_THROW_ON_ERROR);exit;}
        if ($action==='client_analyze') {echo json_encode(['client'=>clientReanalyze($db,(string)($in['id']??$client))],JSON_THROW_ON_ERROR);exit;}
        // Golden Auto narration-first add-on
        if(str_starts_with($action,'narration_')){require_once $private.'/narrations.php';echo json_encode(narrationApi($action,$in,$cfg,$db),JSON_THROW_ON_ERROR);exit;}
        if(str_starts_with($action,'spokesperson_')){echo json_encode(spokespersonApi($action,$in,$cfg,$db),JSON_THROW_ON_ERROR);exit;}
        if ($action==='import') {
            $file=$_FILES['media']??null;if(!$file||$file['error']!==UPLOAD_ERR_OK||!is_uploaded_file($file['tmp_name']))throw new RuntimeException('Upload failed. Check upload_max_filesize and post_max_size in PHP settings.');
            $v=importMediaZip($file['tmp_name'],$in,$cfg);$a=state($db,$invKey)??['vehicles'=>[]];
            $a['vehicles']=array_values(array_filter($a['vehicles'],fn($c)=>$c['StockNumber']!==$v['StockNumber']));$a['vehicles'][]=$v;save($db,$invKey,$a);save($db,'import:'.$v['StockNumber'],$v);
            try{$sheet=assetSheet($v,$cfg);save($db,'sheet:'.$v['Vin'],$sheet);}catch(Throwable $e){$v['sheet_error']=$e->getMessage();}
            echo json_encode(['vehicles'=>$a['vehicles'],'imported'=>$v],JSON_THROW_ON_ERROR);exit;
        }
        if ($action==='logout') {$_SESSION=[];session_destroy();echo '{}';exit;}
        if ($action==='inventory') {$a=state($db,$invKey)??['vehicles'=>[]];echo json_encode($a,JSON_THROW_ON_ERROR);exit;}
        if ($action==='sync_log') {echo json_encode(state($db,'sync_log')??['entries'=>[]],JSON_THROW_ON_ERROR);exit;}
        if ($action==='sync') {
            // The website reader is Golden Auto's (DealerCenter website); other clients import as their analysis recommends.
            if($client!==CLIENT_DEFAULT){
                $c=clientFind($db,$client);
                if(($c['analysis']['platform']??'')!=='Dealer Car Search'||empty($c['analysis']['reachable']))throw new RuntimeException('Inventory import for this client is not set up yet. See its recommended import option above; until then, import cars with the form under Tools.');
                require_once $private.'/importers.php';set_time_limit(170);
                echo json_encode(clientImportDcs($db,$cfg,$c),JSON_THROW_ON_ERROR);exit;
            }
            $list=inventory($cfg['source']);$old=state($db,'inventory')??[];$stocks=array_column($list,'StockNumber');foreach($old['vehicles']??[]as $v)if(($v['source']??'')==='zip'&&!in_array($v['StockNumber'],$stocks,true))$list[]=$v;save($db,'inventory',['vehicles'=>$list,'checked_at'=>gmdate('c')]);
            echo json_encode(['vehicles'=>$list,'checked_at'=>gmdate('c')],JSON_THROW_ON_ERROR);exit;
        }
        if ($action==='detail') {
            $a=state($db,$invKey)??[];$found=false;
            foreach ($a['vehicles']??[] as &$v) if ($v['StockNumber']===($in['stock']??'')) {$v=enrich($v);$out=$v;$found=true;break;}
            if (!$found) throw new RuntimeException('Vehicle not found. Refresh inventory first.');
            save($db,$invKey,$a);$out['script']=script($out,15,$dealer);$out['scripts']=['15'=>$out['script'],'30'=>script($out,30,$dealer)];
            $existing=state($db,'sheet:'.$out['Vin']);
            if($existing && ($existing['gallery_hash']??'')===hash('sha256',json_encode($out['photos']))) $out['asset_sheet']=$existing;
            else try{$out['asset_sheet']=assetSheet($out,$cfg);save($db,'sheet:'.$out['Vin'],$out['asset_sheet']);}catch(Throwable $e){$out['sheet_error']=$e->getMessage();}echo json_encode($out,JSON_THROW_ON_ERROR);exit;
        }
        if ($action==='sheet') {
            $a=state($db,$invKey)??[];$v=null;foreach($a['vehicles']??[] as $c)if($c['StockNumber']===($in['stock']??''))$v=$c;
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
        if ($action==='footage_build') {
            require_once $private.'/footage.php';$job=goldenFootageBuild($db,$cfg,$in,$_FILES['footage']??null);
            echo json_encode(['message'=>'Footage uploaded. The final video with your approved voice and captions is being built and appears under Videos in a few minutes. No paid generation was used.','job'=>$job],JSON_THROW_ON_ERROR);exit;
        }
        if ($action==='job_delete') {require_once $private.'/jobs.php';echo json_encode(goldenJobDelete($db,$cfg,(string)($in['id']??'')),JSON_THROW_ON_ERROR);exit;}
        if ($action==='jobs') {$out=[];foreach($db->query('SELECT payload FROM jobs ORDER BY rowid DESC LIMIT 200')->fetchAll(PDO::FETCH_COLUMN) as $raw){if((json_decode($raw,true)['client']??CLIENT_DEFAULT)===$client)$out[]=$raw;if(count($out)>=30)break;}echo json_encode($out);exit;}
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
            $a=state($db,$invKey)??[];$v=null;
            foreach ($a['vehicles']??[] as $candidate) if ($candidate['StockNumber']===($in['stock']??'')) $v=$candidate;
            if (!$v) throw new RuntimeException('Select a current vehicle first.');
            if(($v['active']??true)===false) throw new RuntimeException('This vehicle is no longer in DealerCenter active inventory. Generation stopped.');
            // Imported cars (ZIP, client website import): availability and price are confirmed by the user, not re-read live.
            if(in_array($v['source']??'',['zip','dcs'],true)){
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
            // voice=elevenlabs: native walkaround driven by an approved ElevenLabs narration (sent as the audio reference);
            // the final video uses that exact audio, so pronunciation is what was approved.
            $voice=(string)($in['voice']??'elevenlabs');if(!in_array($voice,['elevenlabs','native','narration'],true)) throw new RuntimeException('Choose how the voice is made.');
            $approvedVoice=null;
            if($voice==='elevenlabs'){
                require_once $private.'/narrations.php';narrationTables($db);
                $approvedVoice=narrationLoad($db,'narrations',(string)($in['narration_id']??''));
                if(($approvedVoice['status']??'')!=='ready'||empty($approvedVoice['approved']))throw new RuntimeException('Choose an approved voice preview for this car (Narration panel: create, listen, approve).');
                if(($approvedVoice['stock']??'')!==$v['StockNumber']||!priceMatches($approvedVoice['price']??null,$v['price']??null))throw new RuntimeException('The approved voice preview is for a different car or an old price. Make a new preview.');
                narrationCheckAudio($cfg,$approvedVoice);
                $spoken=(string)$approvedVoice['caption_script'];
            }
            $duration=(int)($in['duration']??15);if(!in_array($duration,[15,30],true)) throw new RuntimeException('Choose 15 or 30 seconds.');
            $style=(string)($in['style']??'dynamic');if(!in_array($style,['dynamic','showroom'],true)) throw new RuntimeException('Choose a video style.');
            if($style==='dynamic' && $duration!==15) throw new RuntimeException('The dynamic shot sequence is fixed at 15 seconds. Choose showroom for 30 seconds.');
            if($voice==='elevenlabs' && (int)($approvedVoice['duration']??0)!==$duration) throw new RuntimeException('The approved voice preview was made for a '.($approvedVoice['duration']??'?').'-second video. Choose that duration.');
            if($voice!=='narration' && $style!=='showroom') throw new RuntimeException('Spoken-in-video uses the showroom style. Choose showroom, or ElevenLabs narration for the dynamic sequence.');
            if($voice!=='narration' && $spoken==='') throw new RuntimeException('Write the script the spokesperson will say.');
            $sheetUrl=trim((string)($in['sheet']??''));
            $savedSheet=state($db,'sheet:'.$v['Vin']);
            if($savedSheet && (!$sheetUrl || $sheetUrl===$savedSheet['url'])){if($savedSheet['gallery_hash']!==hash('sha256',json_encode($fresh['photos'])))throw new RuntimeException('Vehicle photos changed. Reopen the vehicle to rebuild its asset sheet.');$sheetUrl=$savedSheet['url'];}
            $presenter=spokespersonFind($db,$cfg,(string)($in['spokesperson']??''));
            $sheet=referenceImageUrl($sheetUrl,$cfg);$avatar=referenceImageUrl($presenter['url'],$cfg);
            $formats=['instagram_reels'=>'9:16','facebook_reels'=>'9:16','facebook_feed'=>'3:4','square'=>'1:1'];
            $format=(string)($in['format']??'');if(!isset($formats[$format])) throw new RuntimeException('Choose a video format.');
            // The exact prompt is part of the fingerprint: a prompt improvement is a new request, a repeat is still blocked.
            $native=$voice!=='narration';
            // Audio reference: the approved narration (elevenlabs), or the optional config voice sample (native).
            if($voice==='elevenlabs'){$voiceRef=validateAppBase($cfg).'/assets/narrations/'.$approvedVoice['audio_name'];}
            else{
                $voiceRef=$voice==='native'?trim((string)($cfg['voice_reference_url']??'')):'';
                if($voiceRef!==''&&!preg_match('~^https://[^\s?#]+\.(mp3|wav|m4a)$~i',$voiceRef))throw new RuntimeException('voice_reference_url in config.php must be a public https link to an MP3, WAV or M4A file.');
            }
            $promptText=match($voice){
                'elevenlabs'=>promptNative($fresh,(string)$approvedVoice['text'],$duration,$presenter['description'],'speech',isset($approvedVoice['audio_duration'])?(float)$approvedVoice['audio_duration']:null,(array)($cfg['respell']??[])),
                'native'=>promptNative($fresh,nativeSpeech($spoken),$duration,$presenter['description'],$voiceRef!=='',null,(array)($cfg['respell']??[])),
                default=>prompt($fresh,$spoken,$style,$duration,$presenter['description'])};
            $fingerprint=jobFingerprint($v,$spoken,$sheet,$avatar,$presenter['description'],$format,$style,$duration,$voice,$promptText,$voiceRef);
            $id=bin2hex(random_bytes(12));$job=['id'=>$id,'client'=>$client,'stock'=>$v['StockNumber'],'vehicle'=>title($v),'spokesperson_id'=>$presenter['id'],'spokesperson'=>$presenter['name'],'format'=>$format,'style'=>$style,'duration'=>$duration,'status'=>'preparing_references','created_at'=>gmdate('c'),'script'=>$spoken,'speech_script'=>$voice==='native'?nativeSpeech($spoken):speechScript($spoken),'price'=>$v['price'],'voice'=>$voice];
            // Native voice: one approval builds the final video (captions timed from the video's own audio).
            if($voice!=='narration')$job['auto_build']=true;
            if($voice==='elevenlabs'){$job['narration_id']=$approvedVoice['id'];$job['speech_script']=(string)$approvedVoice['text'];}
            $db->beginTransaction();
            try{
                $q=$db->prepare('SELECT id,payload FROM jobs WHERE fingerprint=?');$q->execute([$fingerprint]);$previous=$q->fetch(PDO::FETCH_ASSOC);
                if($previous){$prior=json_decode($previous['payload'],true);if(!in_array($prior['status']??'',['failed','canceled'],true))throw new RuntimeException('This exact request already exists. Check its status before generating again.');$q=$db->prepare('UPDATE jobs SET fingerprint=NULL WHERE id=?');$q->execute([$previous['id']]);}
                $q=$db->prepare('INSERT INTO jobs VALUES (?,?,?)');$q->execute([$id,$fingerprint,json_encode($job)]);$db->commit();
            }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}

            try{$hostedSheet=uploadReference($sheet,$cfg);$hostedAvatar=uploadReference($avatar,$cfg);}
            catch(Throwable $e){$job['status']='reference_upload_failed';$job['error']=jobError($e->getMessage());$q=$db->prepare('UPDATE jobs SET fingerprint=NULL,payload=? WHERE id=?');$q->execute([json_encode($job),$id]);throw new RuntimeException($job['error']);}
            $job['status']='submitting';$q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($job),$id]);
            $payload=['prompt'=>$promptText,'image_urls'=>[$hostedSheet,$hostedAvatar],'duration'=>$duration,'resolution'=>'720p','aspect_ratio'=>$formats[$format],'output_format'=>'mp4','generate_audio'=>$native];
            if($voiceRef!=='')$payload['audio_urls']=[$voiceRef];
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
<?php echo pageRender('dashboard',['TITLE_PREFIX'=>$staging?$envLabel.' • ':'','BANNER'=>$staging?'<div class="staging-banner">'.$envLabel.' — test copy. Paid generations here cost real money; production is video.mygoldenauto.net.</div>':'','BOOT'=>'window.CSRF='.json_encode($_SESSION['csrf']).';'.($env==='node'?'window.NODE_ACTIONS='.json_encode(NODE_ACTIONS).';':'')]);
