<?php
declare(strict_types=1);
// "My footage": a real video of the car, filmed by the dealer, becomes the ad. Its own sound is replaced by the
// approved ElevenLabs voice preview, captions are timed from that voice, and the caption worker crops it to the
// publish format and trims it to the video length. No paid video generation is involved.
const FOOTAGE_MAX_BYTES=64*1024*1024;
const FOOTAGE_FORMATS=['instagram_reels','facebook_reels','facebook_feed','square'];

/** ffprobe facts for an uploaded video: ['duration','width','height','format']. */
function footageProbe(array $cfg,string $path):array {
    $ffprobe=(string)($cfg['ffprobe_path']??dirname((string)($cfg['ffmpeg_path']??'/usr/bin/ffmpeg')).'/ffprobe');
    $p=proc_open([$ffprobe,'-v','error','-print_format','json','-show_format','-show_streams',$path],[0=>['file','/dev/null','r'],1=>['pipe','w'],2=>['file','/dev/null','w']],$pipes);
    if(!is_resource($p))throw new RuntimeException('Cannot inspect the uploaded video.');
    $out=stream_get_contents($pipes[1]);fclose($pipes[1]);proc_close($p);
    $d=json_decode((string)$out,true);$video=null;
    foreach(($d['streams']??[]) as $s)if(($s['codec_type']??'')==='video'&&$video===null)$video=$s;
    if(!$video)throw new RuntimeException('The file is not a video we can read. Upload an MP4 or MOV from your phone or camera.');
    return ['duration'=>(float)($d['format']['duration']??$video['duration']??0),'width'=>(int)($video['width']??0),'height'=>(int)($video['height']??0),'format'=>(string)($d['format']['format_name']??'')];
}

/**
 * Create a finished-video job from uploaded footage and an approved voice preview of the same car, price and length.
 * $file is the $_FILES entry; $probe and $move are replaceable in tests. Returns the job.
 */
function goldenFootageBuild(PDO $db,array $cfg,array $in,?array $file,?callable $probe=null,?callable $move=null):array {
    require_once __DIR__.'/narrations.php';require_once __DIR__.'/finishing.php';
    $probe??=fn(string $path)=>footageProbe($cfg,$path);
    $move??=fn(string $from,string $to)=>move_uploaded_file($from,$to);
    if(!($in['confirm_current']??false))throw new RuntimeException('Confirm the vehicle is available and its advertised price is current.');
    require_once __DIR__.'/clients.php';$client=(string)($in['client']??CLIENT_DEFAULT);$a=clientInventory($db,$client);$v=null;
    foreach($a['vehicles']??[] as $candidate)if($candidate['StockNumber']===($in['stock']??''))$v=$candidate;
    if(!$v)throw new RuntimeException('Select a current vehicle first.');
    if(($v['active']??true)===false)throw new RuntimeException('This vehicle is no longer in active inventory.');
    $format=(string)($in['format']??'');if(!in_array($format,FOOTAGE_FORMATS,true))throw new RuntimeException('Choose a publish format.');
    $voice=narrationLoad($db,'narrations',(string)($in['narration_id']??''));
    if(($voice['status']??'')!=='ready'||empty($voice['approved']))throw new RuntimeException('Choose an approved voice preview for this car (step 3).');
    if(($voice['stock']??'')!==$v['StockNumber']||!priceMatches($voice['price']??null,$v['price']??null))
        throw new RuntimeException('The approved voice preview is for a different car or an old price. Make a new preview.');
    narrationCheckAudio($cfg,$voice);
    $duration=(int)$voice['duration'];$speech=(float)($voice['audio_duration']??$duration);

    if(!$file||($file['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK)throw new RuntimeException('Upload failed. Videos must be 64 MB or smaller; export or film at 1080p.');
    if(($file['size']??0)>FOOTAGE_MAX_BYTES)throw new RuntimeException('Video is larger than 64 MB. Export or film at 1080p, 30 seconds or so.');
    $ext=strtolower(pathinfo((string)($file['name']??''),PATHINFO_EXTENSION));
    if(!in_array($ext,['mp4','mov','m4v'],true))throw new RuntimeException('Upload an MP4 or MOV video.');
    $facts=$probe((string)$file['tmp_name']);
    if(!str_contains($facts['format'],'mov')&&!str_contains($facts['format'],'mp4'))throw new RuntimeException('Upload an MP4 or MOV video.');
    if($facts['width']<480||$facts['height']<480)throw new RuntimeException('Video is too small; film at 1080p.');
    $need=$speech+NARRATION_OFFSET+0.5;
    if($facts['duration']<$need)throw new RuntimeException(sprintf('The footage is %.1f s but the approved voice needs at least %.1f s. Film a longer walkaround.',$facts['duration'],$need));
    if($facts['duration']>300)throw new RuntimeException('Footage is longer than 5 minutes. Trim it to under a minute first.');

    $dir=($cfg['asset_dir']??__DIR__.'/../public/assets').'/footage';
    if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Cannot create the footage folder.');
    $name=bin2hex(random_bytes(16)).'.'.($ext==='m4v'?'mp4':$ext);
    if(!$move((string)$file['tmp_name'],$dir.'/'.$name))throw new RuntimeException('Cannot save the uploaded video.');
    chmod($dir.'/'.$name,0644);

    $id=bin2hex(random_bytes(12));
    $job=['id'=>$id,'client'=>$client,'stock'=>$v['StockNumber'],'vehicle'=>title($v),'spokesperson'=>'','format'=>$format,'style'=>'footage',
        'duration'=>(int)min($duration,floor($facts['duration'])),'status'=>'completed','provider'=>'footage','created_at'=>gmdate('c'),
        'script'=>(string)$voice['caption_script'],'speech_script'=>(string)$voice['text'],'price'=>$v['price'],'voice'=>'elevenlabs',
        'narration_id'=>$voice['id'],'audio_swap'=>true,'captions_from_audio'=>true,'footage_file'=>$name,
        'video_url'=>rtrim((string)$cfg['public_base_url'],'/').'/assets/footage/'.$name,
        'finish_status'=>'queued','render_backend'=>'linux','finish_error'=>'','captioned_url'=>null,'auto_queued_at'=>gmdate('c')];
    $q=$db->prepare('INSERT INTO jobs VALUES (?,?,?)');$q->execute([$id,null,json_encode($job,JSON_THROW_ON_ERROR)]);
    return $job;
}

/** Local path of a footage job's uploaded video (the caption worker copies it instead of downloading). */
function footageLocalPath(array $cfg,array $job):string {
    $name=(string)($job['footage_file']??'');
    if(!preg_match('/^[a-f0-9]{32}\.(mp4|mov)$/',$name))throw new RuntimeException('Footage file is missing from this job.');
    $path=($cfg['asset_dir']??__DIR__.'/../public/assets').'/footage/'.$name;
    if(!is_file($path))throw new RuntimeException('The uploaded footage was deleted. Upload it again.');
    return $path;
}
