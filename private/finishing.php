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
    // These timestamps refer to the FINAL timeline, not the unedited master.
    $srt=captionDraft($job['script'],(float)$timing['speech_end']);
    $srt=preg_replace_callback('/(\d{2}):(\d{2}):(\d{2}),(\d{3})/',function($m){
        return srtTime(2+(int)$m[1]*3600+(int)$m[2]*60+(int)$m[3]+(int)$m[4]/1000);
    },$srt);
    $q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');
    $q->execute([json_encode($job,JSON_THROW_ON_ERROR),$job['id']]);
    return ['srt'=>$srt,'note'=>'Two-second intro and smooth dissolve enabled. Uses inventory photo '.($index+1).'. Caption timestamps include the intro. Timing is estimated from the script, not word-aligned transcription; review the final render.'];
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
