<?php
// CLI only. Ubuntu finishing worker; run once per minute.
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit('CLI only');}
require __DIR__.'/app.php';$cfg=require __DIR__.'/config.php';
$cfg['asset_dir']=$cfg['asset_dir']??(is_dir(__DIR__.'/../public/assets')?__DIR__.'/../public/assets':__DIR__.'/../public_html/golden-auto-video/assets');
if(($cfg['render_backend']??'linux')!=='linux')exit;
$db=db($cfg);$lock=fopen($cfg['data_dir'].'/caption-worker.lock','c');if(!$lock||!flock($lock,LOCK_EX|LOCK_NB))exit;
// One-approval build: advance auto-build lip-sync jobs and queue their final render before picking a job below.
require_once __DIR__.'/auto_build.php';
try{foreach(goldenAutoBuild($db,$cfg) as $line)echo $line,"\n";}catch(Throwable $e){echo 'Auto-build step failed: ',jobError($e->getMessage()),"\n";}
function saveRenderJob(PDO $db,array $j):void{$q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($j,JSON_THROW_ON_ERROR),$j['id']]);}
function downloadMaster(string $url,string $path):void {
    $u=parse_url($url);if(($u['scheme']??'')!=='https'||empty($u['host'])||isset($u['user'])||isset($u['pass'])||isset($u['port']))throw new RuntimeException('Invalid generated-video URL.');
    $ips=gethostbynamel($u['host'])?:[];$ip=null;foreach($ips as $candidate)if(filter_var($candidate,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)){$ip=$candidate;break;}
    if(!$ip)throw new RuntimeException('Generated-video host could not be resolved to a public IPv4 address.');
    $f=fopen($path,'wb');$size=0;$c=curl_init($url);curl_setopt_array($c,[CURLOPT_RESOLVE=>[$u['host'].':443:'.$ip],CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>90,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_WRITEFUNCTION=>function($ch,$bytes)use($f,&$size){$size+=strlen($bytes);if($size>100000000)return 0;return fwrite($f,$bytes);}]);
    $ok=curl_exec($c);$status=curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);fclose($f);
    if($ok===false||$status!==200||$size<1000)throw new RuntimeException('Video download failed (HTTP '.$status.'). Refresh the generation result if its link expired.');
}
$job=null;foreach($db->query('SELECT payload FROM jobs ORDER BY rowid')->fetchAll(PDO::FETCH_COLUMN)as $raw){$j=json_decode($raw,true);if(($j['finish_status']??'')==='rendering' && strtotime($j['finish_started_at']??'now')<time()-900){$j['finish_status']='failed';$j['finish_error']='Caption worker stopped before completing. Review the job and queue finishing again.';saveRenderJob($db,$j);}if(($j['finish_status']??'')==='queued'&&($j['render_backend']??($cfg['render_backend']??'linux'))==='linux'){$job=$j;break;}}
if(!$job)exit;
$work=$cfg['data_dir'].'/render-'.bin2hex(random_bytes(10));mkdir($work,0700);$output=null;
try{
    $job['finish_status']='rendering';$job['finish_started_at']=gmdate('c');saveRenderJob($db,$job);
    // Uploaded footage is already on this server; generated videos are downloaded.
    if(($job['provider']??'')==='footage'){require_once __DIR__.'/footage.php';if(!copy(footageLocalPath($cfg,$job),$work.'/master.mp4'))throw new RuntimeException('Cannot read the uploaded footage.');}
    else downloadMaster($job['video_url'],$work.'/master.mp4');
    $narration=null;
    // voice=elevenlabs keeps Seedance's own speech (its lips match it); the approved narration only guides the voice.
    // Swapping in the narration audio is kept for jobs that explicitly ask for it (audio_swap), e.g. later experiments.
    if(($job['voice']??'')==='elevenlabs'&&!empty($job['audio_swap'])){require_once __DIR__.'/finishing.php';$narration=goldenJobNarration($db,$cfg,$job);}
    if(!empty($job['captions_from_audio'])){
        require_once __DIR__.'/finishing.php';
        $job['captions_srt']=$narration
            ?goldenNativeCaptions($cfg,$job,$narration,$work,NARRATION_OFFSET)
            :goldenNativeCaptions($cfg,$job,$work.'/master.mp4',$work);
        saveRenderJob($db,$job);
    }
    file_put_contents($work.'/captions.srt',validateSrt($job['captions_srt'],(float)($job['duration']??15)));
    [$w,$h]=match($job['format']){'facebook_feed'=>[1080,1350],'square'=>[1080,1080],default=>[1080,1920]};
    $name=bin2hex(random_bytes(20)).'.mp4';$output=$cfg['asset_dir'].'/'.$name;
    if(($job['provider']??'')==='fal_lipsync'){
        require_once __DIR__.'/finishing.php';
        goldenFinishRender($db,$cfg,$job,$work,$output,$w,$h);
    }else{
    // Native-voice videos: bold white words, no box or outline, with a faint soft shadow so they stay readable.
    $style=in_array($job['voice']??'',['native','elevenlabs'],true)
        ?'FontName=DejaVu Sans,Bold=1,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=1,Outline=0,Shadow=1.5,Alignment=2,MarginV=28'
        :'FontName=DejaVu Sans,FontSize=10,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=40';
    $filter="scale=$w:$h:force_original_aspect_ratio=increase,crop=$w:$h,setsar=1,subtitles=captions.srt:force_style='$style'";
    
    $args=[(string)($cfg['ffmpeg_path']??'ffmpeg'),'-nostdin','-n','-hide_banner','-loglevel','error','-i','master.mp4'];
    // audio_swap jobs: the approved narration replaces the generated audio.
    if($narration)array_push($args,'-i',$narration,'-filter_complex','[1:a]adelay='.(int)round(NARRATION_OFFSET*1000).':all=1,apad[a]','-map','0:v','-map','[a]','-shortest');
    // Footage is usually longer than the ad: trim it to the video length.
    if(($job['provider']??'')==='footage')array_push($args,'-t',(string)(int)($job['duration']??30));
    array_push($args,'-vf',$filter,'-c:v','libx264','-preset','veryfast','-crf','20','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',$output);
    $p=proc_open($args,[0=>['file','/dev/null','r'],1=>['file',$work.'/ffmpeg.log','a'],2=>['file',$work.'/ffmpeg.log','a']],$pipes,$work);
    if(!is_resource($p))throw new RuntimeException('Cannot start FFmpeg. Check ffmpeg_path and PHP proc_open availability.');
    $status=proc_close($p);if($status!==0||!is_file($output)||filesize($output)<1000){$detail=substr((string)file_get_contents($work.'/ffmpeg.log'),0,1000);throw new RuntimeException('FFmpeg failed: '.$detail);}
    }
    chmod($output,0644);
    $job['finish_status']='completed';$job['finish_error']='';$job['captioned_url']=rtrim($cfg['public_base_url'],'/').'/assets/'.$name;$job['finish_completed_at']=gmdate('c');saveRenderJob($db,$job);echo "Caption render completed\n";
}catch(Throwable $e){if($output&&is_file($output))unlink($output);$job['finish_status']='failed';$job['finish_error']=jobError($e->getMessage());saveRenderJob($db,$job);echo "Caption render failed; details saved to job\n";}
finally{foreach(glob($work.'/*')?:[]as $p)if(is_file($p))unlink($p);rmdir($work);flock($lock,LOCK_UN);fclose($lock);}
