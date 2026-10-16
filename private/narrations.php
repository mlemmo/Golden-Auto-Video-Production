<?php
declare(strict_types=1);

function narrationBridge(array $input):array {
    $p=proc_open(['/usr/bin/python3',__DIR__.'/narration_bridge.py'],
        [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
    if(!is_resource($p))throw new RuntimeException('Cannot start the narration helper.');
    $json=json_encode($input,JSON_THROW_ON_ERROR);$offset=0;
    while($offset<strlen($json)){
        $n=@fwrite($pipes[0],substr($json,$offset,65536));
        if($n===false||$n===0)break;$offset+=$n;
    }
    fclose($pipes[0]);$out=stream_get_contents($pipes[1]);fclose($pipes[1]);
    stream_get_contents($pipes[2]);fclose($pipes[2]);$exit=proc_close($p);
    if($exit!==0||$offset!==strlen($json))throw new RuntimeException('Narration helper failed.');
    $result=json_decode($out,true,512,JSON_THROW_ON_ERROR);
    if(isset($result['error']))throw new RuntimeException($result['error']);
    return $result;
}
function narrationHttp(string $url,string $method,array $headers,?array $body=null):array {
    $r=narrationBridge(['op'=>'http','url'=>$url,'method'=>$method,'headers'=>$headers,
        'body'=>base64_encode($body===null?'':json_encode($body,JSON_THROW_ON_ERROR))]);
    $r['body']=base64_decode($r['body']??'',true);
    if($r['body']===false)throw new RuntimeException('Invalid API response encoding.');
    return $r;
}
function narrationTables(PDO $db):void {
    $db->exec('PRAGMA busy_timeout=5000');
    $db->exec('CREATE TABLE IF NOT EXISTS narrations (id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE,payload TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS narration_lipsync (id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE,payload TEXT NOT NULL)');
}
/** Words as spoken, for comparing caption and spoken text: numbers, prices and the website as words, letters joined ("X-V" → "xv"). */
function narrationWords(string $s):array {
    $s=strtolower(speechScript($s));$s=str_replace(['-','–'],' ',$s);
    $tokens=preg_split('/\s+/',trim(preg_replace('/[^a-z0-9\s]/',' ',$s)),-1,PREG_SPLIT_NO_EMPTY);
    $out=[];$letters='';
    foreach($tokens as $t){if(strlen($t)===1&&ctype_alpha($t)){$letters.=$t;continue;}if($letters!==''){$out[]=$letters;$letters='';}$out[]=$t;}
    if($letters!=='')$out[]=$letters;
    return $out;
}
/**
 * Word differences between a preview's caption text and its spoken text, e.g. ['"with" (captions) vs "and" (spoken)'].
 * Numbers written as words, prices, the website and respellings (config respell, or a close respelling such as
 * "San Ruh-mone") are not differences. Captions show the caption text, so a difference means captions and voice disagree.
 */
function narrationTextDifferences(string $spoken,string $caption,array $respell=[]):array {
    foreach(array_merge(SEEDANCE_RESPELL,$respell) as $word=>$say)if(is_string($word)&&is_string($say)&&$say!=='')$spoken=str_ireplace($say,$word,$spoken);
    $c=narrationWords($caption);$s=narrationWords($spoken);$n=count($c);$m=count($s);
    // Two short spoken syllables may be one respelled caption word ("ruh mone" for "ramon").
    $pair=function(int $i,int $j)use($c,$s):bool{
        if($j<2||strlen($s[$j-2])>4||strlen($s[$j-1])>5)return false;$x=$s[$j-2].$s[$j-1];$y=$c[$i-1];
        return $x[0]===$y[0]&&abs(strlen($x)-strlen($y))<=3&&levenshtein($x,$y)<=(int)floor(max(strlen($x),strlen($y))*0.5);
    };
    $dp=array_fill(0,$n+1,array_fill(0,$m+1,0));$from=$dp;
    for($i=1;$i<=$n;$i++){$dp[$i][0]=$i;$from[$i][0]=1;}
    for($j=1;$j<=$m;$j++){$dp[0][$j]=$j;$from[0][$j]=2;}
    for($i=1;$i<=$n;$i++)for($j=1;$j<=$m;$j++){
        $best=$dp[$i-1][$j]+1;$f=1;
        if($dp[$i][$j-1]+1<$best){$best=$dp[$i][$j-1]+1;$f=2;}
        if(captionWordsMatch($c[$i-1],$s[$j-1])&&$dp[$i-1][$j-1]<=$best){$best=$dp[$i-1][$j-1];$f=3;}
        if($pair($i,$j)&&$dp[$i-1][$j-2]<$best){$best=$dp[$i-1][$j-2];$f=4;}
        $dp[$i][$j]=$best;$from[$i][$j]=$f;
    }
    // Walk back, grouping each run of unmatched words into one difference.
    $diffs=[];$cr=[];$sr=[];$i=$n;$j=$m;
    $close=function()use(&$diffs,&$cr,&$sr){
        if(!$cr&&!$sr)return;$a=implode(' ',array_reverse($cr));$b=implode(' ',array_reverse($sr));
        $diffs[]=$a!==''&&$b!==''?'"'.$a.'" (captions) vs "'.$b.'" (spoken)':($a!==''?'"'.$a.'" only in captions':'"'.$b.'" only in spoken text');
        $cr=[];$sr=[];
    };
    while($i>0||$j>0){
        $f=$from[$i][$j];
        if($f===3){$close();$i--;$j--;}elseif($f===4){$close();$i--;$j-=2;}
        elseif($f===1){$cr[]=$c[$i-1];$i--;}else{$sr[]=$s[$j-1];$j--;}
    }
    $close();
    return array_reverse($diffs);
}
function narrationMismatchNote(array $diffs):string {
    return $diffs?' Caption text and spoken text differ: '.implode('; ',array_slice($diffs,0,5)).'. Captions show the caption text, so fix one of them if they should match.':'';
}
/**
 * ElevenLabs voice settings. 30-second previews are read a little slower (config narration_speed, default 0.9,
 * ElevenLabs range 0.7–1.2) so the speech fills more of the video: a long silent end made Seedance pad it by
 * repeating lines. 15-second previews keep normal speed.
 */
function narrationVoiceSettings(array $cfg,int $duration):array {
    $settings=['stability'=>0.65,'similarity_boost'=>0.75];
    $speed=$duration===30?max(0.7,min(1.2,(float)($cfg['narration_speed']??0.9))):1.0;
    if(abs($speed-1.0)>0.001)$settings['speed']=$speed;
    return $settings;
}
function narrationLoad(PDO $db,string $table,string $id):array {
    if(!in_array($table,['narrations','narration_lipsync','jobs'],true))throw new LogicException('Invalid table.');
    $q=$db->prepare("SELECT payload FROM $table WHERE id=?");$q->execute([$id]);$raw=$q->fetchColumn();
    if($raw===false)throw new RuntimeException('Saved record not found.');
    return json_decode($raw,true,512,JSON_THROW_ON_ERROR);
}
function narrationSave(PDO $db,string $table,array $record,bool $release=false):void {
    if(!in_array($table,['narrations','narration_lipsync'],true))throw new LogicException('Invalid table.');
    $q=$db->prepare("UPDATE $table SET payload=?".($release?',fingerprint=NULL':'').' WHERE id=?');
    $q->execute([json_encode($record,JSON_THROW_ON_ERROR),$record['id']]);
}
function narrationReserve(PDO $db,string $table,array $record,string $fingerprint):void {
    if(!in_array($table,['narrations','narration_lipsync'],true))throw new LogicException('Invalid table.');
    $db->beginTransaction();
    try{
        $q=$db->prepare("INSERT INTO $table VALUES (?,?,?)");
        $q->execute([$record['id'],$fingerprint,json_encode($record,JSON_THROW_ON_ERROR)]);$db->commit();
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();
        if($e instanceof PDOException && str_contains($e->getMessage(),'UNIQUE'))
            throw new RuntimeException('This request already exists. Refresh saved previews or lip-sync jobs; do not resubmit an uncertain request.');
        throw $e;
    }
}
function narrationRejected(int $code):bool {
    return in_array($code,[400,401,402,403,404,405,413,415,422,429],true);
}
function narrationKey(array $cfg,string $name):string {
    $key=trim((string)($cfg[$name]??''));
    if(!$key)throw new RuntimeException('Add '.$name.' to private/config.php first.');return $key;
}
function narrationAudioPath(array $cfg,array $record):string {
    $name=(string)($record['audio_name']??'');
    if(!preg_match('/^[a-f0-9]{32}\.mp3$/',$name))throw new RuntimeException('Invalid narration file.');
    return ($cfg['asset_dir']??__DIR__.'/../public/assets').'/narrations/'.$name;
}
function narrationCheckAudio(array $cfg,array $record):string {
    $path=narrationAudioPath($cfg,$record);
    if(!is_file($path)||!hash_equals((string)($record['audio_hash']??''),hash_file('sha256',$path)))
        throw new RuntimeException('The approved audio is missing or changed. Make and review a new preview.');
    return $path;
}
function narrationSafeQueueUrl(string $url):string {
    $u=parse_url($url);
    if(($u['scheme']??'')!=='https'||($u['host']??'')!=='queue.fal.run'||isset($u['port'])||isset($u['user'])||isset($u['pass'])||!str_starts_with($u['path']??'','/fal-ai/sync-lipsync/'))
        throw new RuntimeException('Unexpected lip-sync tracking URL.');return $url;
}
function narrationApi(string $action,array $in,array $cfg,PDO $db):array {
    narrationTables($db);
    if($action==='narration_voices'){
        $key=narrationKey($cfg,'elevenlabs_key');$voices=[];$next=null;
        for($page=0;$page<5;$page++){
            $url='https://api.elevenlabs.io/v2/voices?page_size=100'.($next?'&next_page_token='.rawurlencode($next):'');
            $r=narrationHttp($url,'GET',['xi-api-key'=>$key]);
            if($r['status']!==200)throw new RuntimeException('Voice listing failed (HTTP '.$r['status'].'). Check API-key voice-read permission.');
            $data=json_decode($r['body'],true,512,JSON_THROW_ON_ERROR);
            foreach($data['voices']??[]as $v)$voices[]=['id'=>$v['voice_id'],'name'=>$v['name'],'labels'=>$v['labels']??[]];
            if(empty($data['has_more'])||empty($data['next_page_token']))break;$next=$data['next_page_token'];
        }
        return ['voices'=>$voices];
    }
    if($action==='narration_list'){
        $list=[];foreach($db->query('SELECT payload FROM narrations ORDER BY rowid DESC LIMIT 50')->fetchAll(PDO::FETCH_COLUMN)as $raw){
            $v=json_decode($raw,true);$v['audio_url']=isset($v['audio_name'])?validateAppBase($cfg).'/assets/narrations/'.$v['audio_name']:null;
            $v['text_mismatch']=narrationTextDifferences((string)($v['text']??''),(string)($v['caption_script']??''),(array)($cfg['respell']??[]));$list[]=$v;
        }
        $sync=[];foreach($db->query('SELECT payload FROM narration_lipsync ORDER BY rowid DESC LIMIT 30')->fetchAll(PDO::FETCH_COLUMN)as $raw){
            $v=json_decode($raw,true);unset($v['status_url'],$v['response_url'],$v['audio_file']);
            // Progress of the final captioned video built from this lip-sync (same id in jobs).
            if(($v['status']??'')==='completed'){$q=$db->prepare('SELECT payload FROM jobs WHERE id=?');$q->execute([$v['id']]);$j=json_decode($q->fetchColumn()?:'null',true);
                if($j)$v['final']=['status'=>$j['finish_status']??'waiting','error'=>$j['finish_error']??'','url'=>$j['captioned_url']??null];}
            $sync[]=$v;
        }
        $videos=[];foreach($db->query('SELECT payload FROM jobs ORDER BY rowid DESC LIMIT 50')->fetchAll(PDO::FETCH_COLUMN)as $raw){
            $v=json_decode($raw,true);if(($v['status']??'')==='completed'&&!empty($v['video_url']))$videos[]=['id'=>$v['id'],'vehicle'=>$v['vehicle'],'stock'=>$v['stock'],'duration'=>$v['duration']??15];
        }
        return ['previews'=>$list,'lipsync'=>$sync,'videos'=>$videos];
    }
    if($action==='narration_preview'){
        if(!($in['approve_spend']??false))throw new RuntimeException('Approve one paid ElevenLabs voice preview.');
        $key=narrationKey($cfg,'elevenlabs_key');
        $voice=trim((string)($in['voice_id']??''));if(!preg_match('/^[A-Za-z0-9_-]{1,128}$/',$voice))throw new RuntimeException('Select a voice.');
        $text=trim((string)($in['text']??''));$captions=trim((string)($in['caption_script']??''));
        if(strlen($text)<10||strlen($text)>1200||strlen($captions)<10||strlen($captions)>1200)throw new RuntimeException('Enter narration and correctly spelled caption text, up to 1,200 characters each.');
        $v=null;foreach((state($db,'inventory')['vehicles']??[])as $candidate)if($candidate['StockNumber']===($in['stock']??''))$v=$candidate;
        if(!$v||($v['active']??true)===false)throw new RuntimeException('Select a saved vehicle that is still in active inventory.');
        $duration=(int)($in['duration']??15);if(!in_array($duration,[15,30],true))throw new RuntimeException('Choose 15 or 30 seconds.');
        $settings=narrationVoiceSettings($cfg,$duration);
        $fingerprint=hash('sha256',json_encode([$v['StockNumber'],$v['price'],$voice,$text,$captions,$duration,$settings]));
        if($in['new_take']??false)$fingerprint=hash('sha256',$fingerprint.random_bytes(16));
        $record=['id'=>bin2hex(random_bytes(16)),'stock'=>$v['StockNumber'],'vehicle'=>title($v),'price'=>$v['price'],
            'voice_id'=>$voice,'text'=>$text,'caption_script'=>$captions,'duration'=>$duration,'speed'=>$settings['speed']??1.0,'status'=>'submitting','created_at'=>gmdate('c')];
        narrationReserve($db,'narrations',$record,$fingerprint);
        $code=0;
        try{
            $r=narrationHttp('https://api.elevenlabs.io/v1/text-to-speech/'.rawurlencode($voice).'?output_format=mp3_44100_128','POST',
                ['xi-api-key'=>$key,'Content-Type'=>'application/json','Accept'=>'audio/mpeg'],
                ['text'=>$text,'model_id'=>'eleven_multilingual_v2','voice_settings'=>$settings]);
            $code=(int)$r['status'];if($code<200||$code>=300)throw new RuntimeException('Voice preview API failed (HTTP '.$code.').');
            $dir=($cfg['asset_dir']??__DIR__.'/../public/assets').'/narrations';
            if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Cannot create narration folder.');
            $record['audio_name']=$record['id'].'.mp3';$path=narrationAudioPath($cfg,$record);
            if(file_put_contents($path,$r['body'],LOCK_EX)!==strlen($r['body']))throw new RuntimeException('Cannot save generated narration.');
            chmod($path,0644);$record['audio_hash']=hash_file('sha256',$path);
            $record['audio_duration']=narrationBridge(['op'=>'probe','path'=>$path])['duration'];
            $record['status']='ready';$record['approved']=false;
            $record['too_long']=$record['audio_duration']>$duration;narrationSave($db,'narrations',$record);
            return ['message'=>'Voice preview saved. Listen and approve pronunciation before lip-sync.'.narrationMismatchNote(narrationTextDifferences($text,$captions,(array)($cfg['respell']??[])))];
        }catch(Throwable $e){
            $record['status']=narrationRejected($code)?'failed':'submission_uncertain';$record['error']=$e->getMessage();
            narrationSave($db,'narrations',$record,narrationRejected($code));throw $e;
        }
    }
    if($action==='narration_approve'){
        if(!($in['reviewed']??false))throw new RuntimeException('Listen to the complete preview and confirm pronunciation.');
        $r=narrationLoad($db,'narrations',(string)($in['id']??''));
        if($r['status']!=='ready')throw new RuntimeException('Preview is not ready.');
        narrationCheckAudio($cfg,$r);if($r['too_long']??false)throw new RuntimeException('Audio is too long. Shorten the narration and create another preview.');
        $r['approved']=true;$r['approved_at']=gmdate('c');narrationSave($db,'narrations',$r);
        return ['message'=>'Narration approved. Lip-sync requires a separate paid approval.'.narrationMismatchNote(narrationTextDifferences((string)$r['text'],(string)$r['caption_script'],(array)($cfg['respell']??[])))];
    }
    if($action==='narration_lipsync'){
        if(!($in['approve_spend']??false)||!($in['confirm_current']??false))throw new RuntimeException('Confirm current vehicle price/availability and approve one paid lip-sync request.');
        $key=narrationKey($cfg,'fal_key');$audio=narrationLoad($db,'narrations',(string)($in['narration_id']??''));
        if($audio['status']!=='ready'||empty($audio['approved']))throw new RuntimeException('Approve the voice preview first.');
        $source=narrationLoad($db,'jobs',(string)($in['video_id']??''));
        if(($source['status']??'')!=='completed'||empty($source['video_url']))throw new RuntimeException('Choose a completed video.');
        if(($source['stock']??'')!==$audio['stock']||($source['price']??null)!==$audio['price'])throw new RuntimeException('Preview and video must be for the same vehicle and price.');
        $current=null;foreach((state($db,'inventory')['vehicles']??[])as $candidate)if($candidate['StockNumber']===$audio['stock'])$current=$candidate;
        if(!$current||($current['active']??true)===false||$current['price']!==$audio['price'])throw new RuntimeException('Saved vehicle price changed or vehicle was removed. Create a new narration.');
        $duration=(int)($source['duration']??15);
        if($duration!==$audio['duration'])throw new RuntimeException('Preview target duration must match the selected video.');
        $path=narrationCheckAudio($cfg,$audio);publicImage($source['video_url']);
        $padded=narrationBridge(['op'=>'pad','path'=>$path,'duration'=>$duration]);
        // Publish padded audio as a WAV: this model rejects inline data URIs.
        $prefix='data:audio/wav;base64,';
        if(!str_starts_with($padded['audio_url']??'', $prefix))
            throw new RuntimeException('Unexpected padded audio format.');
        $wav=base64_decode(substr($padded['audio_url'],strlen($prefix)),true);
        if($wav===false||substr($wav,0,4)!=='RIFF'||substr($wav,8,4)!=='WAVE')
            throw new RuntimeException('Invalid padded WAV audio.');
        $wavName=bin2hex(random_bytes(16)).'.wav';
        $wavPath=dirname($path).'/'.$wavName;
        if(file_put_contents($wavPath,$wav,LOCK_EX)!==strlen($wav))
            throw new RuntimeException('Cannot save padded narration.');
        if(!chmod($wavPath,0644))
            throw new RuntimeException('Cannot make padded narration readable.');
        $padded['audio_url']=validateAppBase($cfg).'/assets/narrations/'.$wavName;
        $record=['id'=>bin2hex(random_bytes(16)),'stock'=>$audio['stock'],'vehicle'=>$audio['vehicle'],
            'narration_id'=>$audio['id'],'source_video_id'=>$source['id'],'audio_file'=>$wavName,'auto_build'=>!empty($in['auto_build']),'status'=>'submitting','created_at'=>gmdate('c')];
        narrationReserve($db,'narration_lipsync',$record,hash('sha256',$audio['audio_hash'].'|'.$source['id']));
        $code=0;
        try{
            $r=narrationHttp('https://queue.fal.run/fal-ai/sync-lipsync/v2','POST',
                ['Authorization'=>'Key '.$key,'Content-Type'=>'application/json'],
                ['model'=>'lipsync-2','video_url'=>$source['video_url'],'audio_url'=>$padded['audio_url'],'sync_mode'=>'silence']);
            $code=(int)$r['status'];if($code<200||$code>=300)throw new RuntimeException('Lip-sync API failed (HTTP '.$code.'): '.($r['detail']??'No provider details.'));
            $result=json_decode($r['body'],true,512,JSON_THROW_ON_ERROR);
            if(empty($result['request_id']))throw new RuntimeException('Lip-sync request ID missing; check fal request history.');
            $record['request_id']=$result['request_id'];
            foreach(['status_url','response_url']as $field)$record[$field]=narrationSafeQueueUrl((string)($result[$field]??''));
            $record['status']='queued';narrationSave($db,'narration_lipsync',$record);
            return ['message'=>'Lip-sync submitted once. Refresh its status; do not generate again.'];
        }catch(Throwable $e){$record['status']=narrationRejected($code)?'failed':'submission_uncertain';$record['error']=$e->getMessage();
            narrationSave($db,'narration_lipsync',$record,narrationRejected($code));throw $e;}
    }
    if($action==='narration_poll'){
        $key=narrationKey($cfg,'fal_key');$record=narrationLoad($db,'narration_lipsync',(string)($in['id']??''));
        if(in_array($record['status'],['completed','failed'],true))return ['message'=>'Lip-sync is '.$record['status'].'.'];
        if(empty($record['request_id']))throw new RuntimeException('Submission is uncertain. Check fal request history before retrying.');
        $headers=['Authorization'=>'Key '.$key];
        $r=narrationHttp(narrationSafeQueueUrl($record['status_url']),'GET',$headers);
        if(!in_array((int)$r['status'],[200,202],true))throw new RuntimeException('Status check failed (HTTP '.$r['status'].'). No new request submitted.');
        $state=json_decode($r['body'],true,512,JSON_THROW_ON_ERROR);
        if(($state['status']??'')==='COMPLETED'){
            if(!empty($state['error'])){$record['status']='failed';$record['error']='Provider reported a failed lip-sync. Check fal history.';}
            else{
                $r=narrationHttp(narrationSafeQueueUrl($record['response_url']),'GET',$headers);
                if((int)$r['status']===422){
                    $record['status']='failed';
                    $record['error']='fal rejected the generation input (HTTP 422). See fal request details.';
                    narrationSave($db,'narration_lipsync',$record,true);
                    return ['message'=>'Previous request failed validation. After correcting the input, you can submit again.'];
                }
                if($r['status']!==200)throw new RuntimeException('Result fetch failed (HTTP '.$r['status'].'). Check fal history; refresh without resubmitting.');
                $result=json_decode($r['body'],true,512,JSON_THROW_ON_ERROR);$url=(string)($result['video']['url']??'');publicImage($url);
                $source=narrationLoad($db,'jobs',$record['source_video_id']);$audio=narrationLoad($db,'narrations',$record['narration_id']);
                // Create a fresh completed job for the existing caption workflow; original stays intact.
                $job=['id'=>$record['id'],'stock'=>$source['stock'],'vehicle'=>$source['vehicle'],'price'=>$source['price'],
                    'format'=>$source['format'],'style'=>$source['style']??'showroom','duration'=>$source['duration']??15,
                    'status'=>'completed','video_url'=>$url,'script'=>$audio['caption_script'],'speech_script'=>$audio['text'],
                    'created_at'=>gmdate('c'),'provider'=>'fal_lipsync','narration_id'=>$audio['id'],'source_video_id'=>$source['id'],
                    'auto_build'=>!empty($record['auto_build'])];
                $q=$db->prepare('INSERT OR IGNORE INTO jobs (id,fingerprint,payload) VALUES (?,NULL,?)');
                $q->execute([$job['id'],json_encode($job,JSON_THROW_ON_ERROR)]);
                $record['status']='completed';$record['video_url']=$url;$record['completed_at']=gmdate('c');
            }
        }else{$record['status']=match($state['status']??''){'IN_QUEUE'=>'queued','IN_PROGRESS'=>'in_progress',default=>'unknown'};}
        narrationSave($db,'narration_lipsync',$record);
        return ['message'=>'Lip-sync: '.$record['status'].'. Completed results also appear in Video jobs for captions.'];
    }
    if($action==='narration_delete'){
        $id=(string)($in['id']??'');$audio=narrationLoad($db,'narrations',$id);
        if(($audio['status']??'')==='submitting')throw new RuntimeException('This voice preview is still being created. Refresh before deleting.');
        // Lip-synced videos keep needing the approved MP3 for caption timing, so in-use previews stay.
        $q=$db->prepare("SELECT COUNT(*) FROM narration_lipsync WHERE json_extract(payload,'$.narration_id')=? AND json_extract(payload,'$.status')<>'failed'");$q->execute([$id]);
        if($q->fetchColumn()>0)throw new RuntimeException('This preview is used by a lip-sync job. Delete that lip-sync job first.');
        $q=$db->prepare("SELECT COUNT(*) FROM jobs WHERE json_extract(payload,'$.narration_id')=?");$q->execute([$id]);
        if($q->fetchColumn()>0)throw new RuntimeException('A lip-synced video uses this preview for its captions, so it cannot be deleted.');
        $q=$db->prepare('DELETE FROM narrations WHERE id=?');$q->execute([$id]);
        if(isset($audio['audio_name'])){$path=narrationAudioPath($cfg,$audio);if(is_file($path))unlink($path);}
        return ['message'=>'Voice preview deleted.'];
    }
    if($action==='narration_lipsync_delete'){
        $id=(string)($in['id']??'');$record=narrationLoad($db,'narration_lipsync',$id);
        if(in_array($record['status']??'',['submitting','queued','in_progress'],true))throw new RuntimeException('This lip-sync job is still running at fal. Refresh its status until it completes or fails before deleting.');
        $q=$db->prepare('DELETE FROM narration_lipsync WHERE id=?');$q->execute([$id]);
        $wav=(string)($record['audio_file']??'');
        if(preg_match('/^[a-f0-9]{32}\.wav$/',$wav)){$path=($cfg['asset_dir']??__DIR__.'/../public/assets').'/narrations/'.$wav;if(is_file($path))unlink($path);}
        return ['message'=>($record['status']??'')==='completed'?'Lip-sync job deleted. Its video stays in Video jobs.':'Lip-sync job deleted.'];
    }
    throw new RuntimeException('Unknown narration action.');
}
