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
            $v=json_decode($raw,true);$v['audio_url']=isset($v['audio_name'])?validateAppBase($cfg).'/assets/narrations/'.$v['audio_name']:null;$list[]=$v;
        }
        $sync=[];foreach($db->query('SELECT payload FROM narration_lipsync ORDER BY rowid DESC LIMIT 30')->fetchAll(PDO::FETCH_COLUMN)as $raw){
            $v=json_decode($raw,true);unset($v['status_url'],$v['response_url']);$sync[]=$v;
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
        if(!$v)throw new RuntimeException('Select a saved vehicle.');
        $duration=(int)($in['duration']??15);if(!in_array($duration,[15,30],true))throw new RuntimeException('Choose 15 or 30 seconds.');
        $fingerprint=hash('sha256',json_encode([$v['StockNumber'],$v['price'],$voice,$text,$captions,$duration]));
        if($in['new_take']??false)$fingerprint=hash('sha256',$fingerprint.random_bytes(16));
        $record=['id'=>bin2hex(random_bytes(16)),'stock'=>$v['StockNumber'],'vehicle'=>title($v),'price'=>$v['price'],
            'voice_id'=>$voice,'text'=>$text,'caption_script'=>$captions,'duration'=>$duration,'status'=>'submitting','created_at'=>gmdate('c')];
        narrationReserve($db,'narrations',$record,$fingerprint);
        $code=0;
        try{
            $r=narrationHttp('https://api.elevenlabs.io/v1/text-to-speech/'.rawurlencode($voice).'?output_format=mp3_44100_128','POST',
                ['xi-api-key'=>$key,'Content-Type'=>'application/json','Accept'=>'audio/mpeg'],
                ['text'=>$text,'model_id'=>'eleven_multilingual_v2','voice_settings'=>['stability'=>0.65,'similarity_boost'=>0.75]]);
            $code=(int)$r['status'];if($code<200||$code>=300)throw new RuntimeException('Voice preview API failed (HTTP '.$code.').');
            $dir=($cfg['asset_dir']??__DIR__.'/../public/assets').'/narrations';
            if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Cannot create narration folder.');
            $record['audio_name']=$record['id'].'.mp3';$path=narrationAudioPath($cfg,$record);
            if(file_put_contents($path,$r['body'],LOCK_EX)!==strlen($r['body']))throw new RuntimeException('Cannot save generated narration.');
            chmod($path,0644);$record['audio_hash']=hash_file('sha256',$path);
            $record['audio_duration']=narrationBridge(['op'=>'probe','path'=>$path])['duration'];
            $record['status']='ready';$record['approved']=false;
            $record['too_long']=$record['audio_duration']>$duration;narrationSave($db,'narrations',$record);
            return ['message'=>'Voice preview saved. Listen and approve pronunciation before lip-sync.'];
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
        return ['message'=>'Narration approved. Lip-sync requires a separate paid approval.'];
    }
    if($action==='narration_lipsync'){
        if(!($in['approve_spend']??false)||!($in['confirm_current']??false))throw new RuntimeException('Confirm current vehicle price/availability and approve one paid lip-sync request.');
        $key=narrationKey($cfg,'fal_key');$audio=narrationLoad($db,'narrations',(string)($in['narration_id']??''));
        if($audio['status']!=='ready'||empty($audio['approved']))throw new RuntimeException('Approve the voice preview first.');
        $source=narrationLoad($db,'jobs',(string)($in['video_id']??''));
        if(($source['status']??'')!=='completed'||empty($source['video_url']))throw new RuntimeException('Choose a completed video.');
        if(($source['stock']??'')!==$audio['stock']||($source['price']??null)!==$audio['price'])throw new RuntimeException('Preview and video must be for the same vehicle and price.');
        $current=null;foreach((state($db,'inventory')['vehicles']??[])as $candidate)if($candidate['StockNumber']===$audio['stock'])$current=$candidate;
        if(!$current||$current['price']!==$audio['price'])throw new RuntimeException('Saved vehicle price changed or vehicle was removed. Create a new narration.');
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
            'narration_id'=>$audio['id'],'source_video_id'=>$source['id'],'status'=>'submitting','created_at'=>gmdate('c')];
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
                    'created_at'=>gmdate('c'),'provider'=>'fal_lipsync','narration_id'=>$audio['id'],'source_video_id'=>$source['id']];
                $q=$db->prepare('INSERT OR IGNORE INTO jobs (id,fingerprint,payload) VALUES (?,NULL,?)');
                $q->execute([$job['id'],json_encode($job,JSON_THROW_ON_ERROR)]);
                $record['status']='completed';$record['video_url']=$url;$record['completed_at']=gmdate('c');
            }
        }else{$record['status']=match($state['status']??''){'IN_QUEUE'=>'queued','IN_PROGRESS'=>'in_progress',default=>'unknown'};}
        narrationSave($db,'narration_lipsync',$record);
        return ['message'=>'Lip-sync: '.$record['status'].'. Completed results also appear in Video jobs for captions.'];
    }
    throw new RuntimeException('Unknown narration action.');
}
