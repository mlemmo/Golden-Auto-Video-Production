<?php
declare(strict_types=1);

function goldenFinishPython(array $input):array {
    $p=proc_open(['/usr/bin/python3',__DIR__.'/finish_video.py'],
        [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
    if(!is_resource($p))throw new RuntimeException('Cannot start finishing helper.');
    $body=json_encode($input,JSON_THROW_ON_ERROR);
    fwrite($pipes[0],$body);fclose($pipes[0]);
    $out=stream_get_contents($pipes[1]);fclose($pipes[1]);
    $err=stream_get_contents($pipes[2]);fclose($pipes[2]);$code=proc_close($p);
    $result=json_decode($out,true);
    if(!is_array($result))throw new RuntimeException('Finishing helper failed. Check python3-pil and fonts-dejavu-core installation.');
    if($code!==0||isset($result['error']))throw new RuntimeException($result['error']??'Finishing helper failed.');
    return $result;
}
function goldenFinishAsset(array $cfg,string $name):string {
    if(!preg_match('/^[a-f0-9]{40}\.(jpg|jpeg|png|webp)$/i',$name))throw new RuntimeException('Finishing needs an imported inventory photo.');
    $dir=realpath($cfg['asset_dir']??__DIR__.'/../public/assets');
    $path=$dir===false?false:realpath($dir.'/'.$name);
    if(!$path||dirname($path)!==$dir||!is_file($path)||filesize($path)>20000000)
        throw new RuntimeException('Selected closing-card photo is missing or too large.');
    return $path;
}
function goldenFinishDraft(PDO $db,array $cfg,array &$job):array {
    $q=$db->prepare('SELECT payload FROM narrations WHERE id=?');$q->execute([$job['narration_id']??'']);
    $audio=json_decode($q->fetchColumn()?:'null',true);
    if(!$audio||empty($audio['approved']))throw new RuntimeException('Approved narration record not found.');
    require_once __DIR__.'/narrations.php';
    $path=narrationCheckAudio($cfg,$audio);
    $timing=goldenFinishPython(['op'=>'analyze','audio'=>$path,'audio_hash'=>$audio['audio_hash'],
        'ffmpeg'=>$cfg['ffmpeg_path']??'/usr/bin/ffmpeg']);
    $duration=(float)($job['duration']??15);
    if(2+$timing['source_end']+.5>$duration)
        throw new RuntimeException('Narration is too long for a two-second intro and closing card. Shorten the narration or use a longer source video. No audio was cut.');
    $vehicle=null;foreach(state($db,'inventory')['vehicles']??[] as $v)
        if((string)($v['StockNumber']??'')===(string)$job['stock']){$vehicle=$v;break;}
    if(!$vehicle)throw new RuntimeException('Vehicle is missing from inventory. Import its photos before finishing.');
    if((float)($vehicle['price']??-1)!==(float)($job['price']??-2))throw new RuntimeException('Vehicle price changed. Review the narration before finishing.');
    $index=(int)($cfg['finishing_photo_index'][$job['stock']]??0);
    $url=(string)($vehicle['photos'][$index]??'');
    $base=rtrim($cfg['public_base_url'],'/').'/assets/';
    if(!str_starts_with($url,$base))throw new RuntimeException('Import vehicle photos into this dashboard before finishing.');
    $name=substr($url,strlen($base));$photo=goldenFinishAsset($cfg,$name);
    $job['finishing_plan']=['version'=>1,'intro'=>2,'fade'=>.625,'duration'=>$duration,
        'source_end'=>$timing['source_end'],'speech_end'=>$timing['speech_end'],
        'photo_name'=>$name,'photo_hash'=>hash_file('sha256',$photo),'photo_index'=>$index,
        'audio_hash'=>$audio['audio_hash']];
    // Cues follow the pauses measured in the approved audio. Speech starts at t=2 on the FINAL timeline.
    $cues=captionCues($job['script'],(string)$job['vehicle'],$timing['spans']??[],(float)$timing['speech_end']);
    if(!$cues)throw new RuntimeException('Caption script is empty.');
    $srt=captionSrt($cues,2.0);
    $q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');
    $q->execute([json_encode($job,JSON_THROW_ON_ERROR),$job['id']]);
    return ['srt'=>$srt,'note'=>'Two-second intro and smooth dissolve enabled. Uses inventory photo '.($index+1).'. Caption timestamps include the intro. Cue timing follows the pauses in the approved audio and is spread by syllable count inside each sentence; it is not word-level transcription, so review the final render.'];
}
function goldenFinishRender(PDO $db,array $cfg,array $job,string $work,string $output,int $w,int $h):void {
    $plan=$job['finishing_plan']??null;
    if(!$plan||($plan['version']??0)!==1)throw new RuntimeException('Open Review captions again to prepare the intro and closing card, then queue finishing.');
    $photo=goldenFinishAsset($cfg,$plan['photo_name']);
    if(!hash_equals($plan['photo_hash'],hash_file('sha256',$photo)))throw new RuntimeException('Closing photo changed. Review captions again.');
    $q=$db->prepare('SELECT payload FROM narrations WHERE id=?');$q->execute([$job['narration_id']]);
    $audio=json_decode($q->fetchColumn()?:'null',true);
    require_once __DIR__.'/narrations.php';
    if(!$audio||empty($audio['approved'])||!hash_equals($plan['audio_hash'],$audio['audio_hash']??''))
        throw new RuntimeException('Approved narration changed. Review captions again.');
    narrationCheckAudio($cfg,$audio);
    // Prevent captions from appearing over the introductory or closing cards.
    preg_match_all('/(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/',$job['captions_srt'],$matches,PREG_SET_ORDER);
    foreach($matches as $m){
        $a=(int)$m[1]*3600+(int)$m[2]*60+(int)$m[3]+(int)$m[4]/1000;
        $b=(int)$m[5]*3600+(int)$m[6]*60+(int)$m[7]+(int)$m[8]/1000;
        if($a<2||$b>2+$plan['source_end']+.001)throw new RuntimeException('Keep caption cues between 2 seconds and the closing card. Reopen Review captions for an updated draft.');
    }
    goldenFinishPython(['op'=>'render','work'=>$work,'output'=>$output,'photo'=>$photo,
        'title'=>$job['vehicle'],'width'=>$w,'height'=>$h,'plan'=>$plan,
        'ffmpeg'=>$cfg['ffmpeg_path']??'/usr/bin/ffmpeg']);
}

/**
 * Captions for a native-voice video, timed from its speech: the master video's own audio, or (voice=elevenlabs)
 * the approved narration that replaces it, shifted by $offset seconds.
 */
function goldenNativeCaptions(array $cfg,array $job,string $source,string $work,float $offset=0.0):string {
    $ffmpeg=(string)($cfg['ffmpeg_path']??'/usr/bin/ffmpeg');$wav=$work.'/speech.wav';
    $p=proc_open([$ffmpeg,'-nostdin','-v','error','-y','-i',$source,'-vn','-ac','1','-ar','16000','-t','61',$wav],[0=>['file','/dev/null','r'],1=>['file','/dev/null','w'],2=>['file','/dev/null','w']],$pipes);
    if(!is_resource($p)||proc_close($p)!==0||!is_file($wav))throw new RuntimeException('No usable speech audio found for the captions.');
    $timing=goldenFinishPython(['op'=>'analyze','audio'=>$wav,'audio_hash'=>hash_file('sha256',$wav),'ffmpeg'=>$ffmpeg]);
    // Caption the words she actually said (local speech recognition, when configured), timed by the measured pauses.
    $heard=goldenHeardWords($cfg,$wav,$work);
    $spoken=$heard?captionSpokenScript((string)$job['script'],$heard):null;
    $cues=captionCues($spoken??(string)$job['script'],(string)($job['vehicle']??''),$timing['spans']??[],(float)$timing['speech_end']);
    if(!$cues)throw new RuntimeException('Caption script is empty.');
    return validateSrt(captionSrt($cues,$offset),(float)($job['duration']??30));
}
/**
 * Recognized words [[text,start,end],...] (seconds) from local whisper.cpp (config whisper_cli + whisper_model).
 * Free and offline. Returns [] when not configured or when recognition fails, so captions fall back to pause timing.
 */
function goldenHeardWords(array $cfg,string $wav,string $work):array {
    $cli=(string)($cfg['whisper_cli']??'');$model=(string)($cfg['whisper_model']??'');
    if($cli===''||$model===''||!is_executable($cli)||!is_file($model))return [];
    $base=$work.'/heard';@unlink($base.'.json');
    // No script prompt: it would bias recognition toward the script and hide words she added.
    $args=[$cli,'-m',$model,'-f',$wav,'-l','en','-t',(string)max(1,(int)($cfg['whisper_threads']??4)),'-ml','1','-sow','-oj','-of',$base,'-np'];
    $p=proc_open($args,[0=>['file','/dev/null','r'],1=>['file','/dev/null','w'],2=>['file','/dev/null','w']],$pipes);
    if(!is_resource($p))return [];
    $deadline=time()+240;
    while(proc_get_status($p)['running']){if(time()>$deadline){proc_terminate($p,9);proc_close($p);return [];}usleep(200000);}
    proc_close($p);
    $d=json_decode((string)@file_get_contents($base.'.json'),true);$words=[];
    foreach(($d['transcription']??[]) as $seg){
        $t=trim((string)($seg['text']??''));if($t===''||!isset($seg['offsets']['from'],$seg['offsets']['to']))continue;
        $words[]=[$t,$seg['offsets']['from']/1000,$seg['offsets']['to']/1000];
    }
    return $words;
}
/** voice=elevenlabs: the approved narration (hash-checked) that becomes the final video's audio. */
const NARRATION_OFFSET=0.5;
function goldenJobNarration(PDO $db,array $cfg,array $job):string {
    require_once __DIR__.'/narrations.php';
    $q=$db->prepare('SELECT payload FROM narrations WHERE id=?');$q->execute([$job['narration_id']??'']);
    $audio=json_decode($q->fetchColumn()?:'null',true);
    if(!$audio||empty($audio['approved']))throw new RuntimeException('The approved voice preview for this video was deleted. Generate again with an approved preview.');
    return narrationCheckAudio($cfg,$audio);
}
