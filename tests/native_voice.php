<?php
declare(strict_types=1);
// Native-voice Seedance path. No paid API calls: Higgsfield status is stubbed; captions are timed on a generated test video.
require __DIR__.'/../private/app.php';require __DIR__.'/../private/auto_build.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$v=['Year'=>2013,'Make'=>'SUBARU','Model'=>'XV CROSSTREK','price'=>14688.25];
$speech=nativeSpeech('Take a look at this 2013 SUBARU XV CROSSTREK here at Golden Auto in San Ramon. Just $14,688. Book your test drive at mygoldenauto.net.');
verify(str_contains($speech,'my golden auto dot net')&&!str_contains($speech,'N, E, T'),'website is said as "dot net" for the native voice');
$p=promptNative($v,$speech,30,'friendly woman, cream dress');
verify(str_contains($p,'word for word')&&str_contains($p,'"'.seedanceRespell($speech).'"'),'prompt carries the exact spoken words');
verify(str_contains($p,'X-V')&&!str_contains($p,'$14,688'),'spoken words use the pronunciation form');
verify(str_contains($p,'four wide shots')&&str_contains($p,'Shot 4 (23–30 s)')&&str_contains($p,'No music'),'prompt sets four wide shots around the car and clean voice audio');
verify(str_contains($p,'entire car is visible from bumper to bumper')&&str_contains($p,'never closer to the camera than the car'),'whole car in frame, spokesperson beside it');
verify(str_contains($p,'finishes by 28 seconds')&&!str_contains($p,'Reference audio 1'),'speech ends before the cut-off; no voice reference unless configured');
verify(str_contains(promptNative($v,$speech,30,'x',true),'Reference audio 1 is the spokesperson'),'voice reference described when configured');
verify(str_contains(promptNative($v,$speech,30,'x','speech'),'exact recording of her speech'),'approved narration described as the exact speech');
$timed=promptNative($v,$speech,30,'x','speech',20.7);
verify(str_contains($timed,'finishes by 21.2 seconds')&&str_contains($timed,'At 21.2 seconds she has finished speaking')&&str_contains($timed,'do not slow it down'),'speech limited to the narration length, silent smile afterwards');
verify(!str_contains($timed,'relaxed and unhurried'),'no pacing instruction that fights the recording');
verify(!str_contains(promptNative($v,$speech,30,'x','speech',29.0),'has finished speaking'),'no silent tail when the narration fills the video');
verify(str_contains($timed,'Shot 4 (17–22 s)')&&str_contains($timed,'Shot 5 (22–26 s): camera-only shot of the parked car alone')&&str_contains($timed,'Shot 6 (26–30 s)')&&str_contains($timed,'followed by two slow camera-only pan shots'),'short narration: presenter shots fit the speech, then two pan shots of the car');
verify(str_contains($timed,'the spokesperson is not in this shot and nobody speaks')&&str_contains($timed,'during the pan shots only the soft room tone'),'nobody on screen or speaking during the pan shots');
$one=promptNative($v,$speech,30,'x','speech',26.0);
verify(str_contains($one,'Shot 5 (27–30 s)')&&!str_contains($one,'Shot 6')&&str_contains($one,'followed by one slow camera-only pan shot of'),'3-6 s left: one pan shot');
verify(!str_contains(promptNative($v,$speech,30,'x','speech',29.0),'Shot 5')&&!str_contains($p,'Shot 5'),'no pan shots when the speech fills the video or without a narration');
verify(str_contains($p,'says each sentence exactly once')&&str_contains($timed,'never repeats a sentence, the price or the website'),'she says each sentence once and never repeats the price');
require_once __DIR__.'/../private/narrations.php';
verify((narrationVoiceSettings([],30)['speed']??null)===0.9&&!isset(narrationVoiceSettings([],15)['speed']),'30-second previews are read a little slower; 15-second at normal speed');
verify(narrationVoiceSettings(['narration_speed'=>1.5],30)['speed']===1.2&&!isset(narrationVoiceSettings(['narration_speed'=>1.0],30)['speed']),'narration speed is configurable and kept in the ElevenLabs range');
verify(numberSpeech('2013 Subaru, 2008 Toyota, 1999 Ford, 2020 Kia, 60,000 miles, model 1500')==='twenty thirteen Subaru, two thousand eight Toyota, nineteen ninety-nine Ford, twenty twenty Kia, sixty thousand miles, model 1500','years and comma numbers spoken as words');
verify(!str_contains(speechScript('This 2013 SUBARU has 60,000 miles. Just $14,688.'),'2013')&&str_contains(speechScript('Just $14,688.'),'fourteen thousand six hundred eighty-eight dollars'),'speech scripts use the number words, prices unchanged');
verify(str_contains($p,'"San Ramon" is pronounced san rah-MOAN')&&str_contains($p,'never spelled out letter by letter'),'pronunciation guide for city and website');
verify(str_contains(promptNative($v,$speech,30,'x',false,null,['San Ramon'=>'San Ra-MOAN']),'San Ra-MOAN'),'respelling can be changed in config');
verify(str_contains($p,'Golden Auto in San Rah-moan')&&!str_contains(captionDisplayText('Golden Auto in San Ramon.'),'moan'),'spoken line respells San Ramon; captions keep the real spelling');
verify(!str_contains(promptNative($v,'Just fourteen thousand dollars.'),'Pronunciation:'),'no pronunciation note when the words are absent');
try{promptNative($v,'  ');verify(false,'empty script rejected');}catch(RuntimeException $e){verify(true,'empty script rejected');}

$dir=sys_get_temp_dir().'/ga-native-'.bin2hex(random_bytes(4));mkdir("$dir/data",0700,true);mkdir("$dir/assets",0700);
$cfg=['asset_dir'=>"$dir/assets",'data_dir'=>"$dir/data",'public_base_url'=>'https://example.com:4343','ffmpeg_path'=>'/usr/bin/ffmpeg'];
$db=db($cfg);narrationTables($db);
$put=function(array $r)use($db){$q=$db->prepare('INSERT INTO jobs VALUES (?,?,?)');$q->execute([$r['id'],null,json_encode($r)]);};
$job=fn(string $id)=>json_decode($db->query("SELECT payload FROM jobs WHERE id='$id'")->fetchColumn(),true);
try{
    $put(['id'=>'N1','voice'=>'native','auto_build'=>true,'request_id'=>'r1','status'=>'queued','duration'=>30,'script'=>'x']);
    $put(['id'=>'N2','voice'=>'native','auto_build'=>true,'request_id'=>'r2','status'=>'failed']);
    $put(['id'=>'N3','voice'=>'narration','request_id'=>'r3','status'=>'queued']);
    $put(['id'=>'E1','voice'=>'elevenlabs','auto_build'=>true,'request_id'=>'e1','status'=>'completed','video_url'=>'https://v.example/e1.mp4']);
    $asked=[];$stub=function($rid)use(&$asked){$asked[]=$rid;return ['status'=>'in_progress'];};
    goldenAutoBuild($db,$cfg,fn($id)=>null,$stub);
    verify($asked===['r1']&&$job('N1')['status']==='in_progress','only running native jobs are checked');
    verify(($job('E1')['finish_status']??'')==='queued'&&!empty($job('E1')['captions_from_audio']),'approved-voice video is queued for its final render');
    goldenAutoBuild($db,$cfg,fn($id)=>null,fn($rid)=>['status'=>'completed','video'=>['url'=>'https://v.example/n1.mp4']]);
    $n1=$job('N1');
    verify(($n1['finish_status']??'')==='queued'&&!empty($n1['captions_from_audio'])&&$n1['video_url']==='https://v.example/n1.mp4','completed native video is queued for captions from its own audio');
    $asked=[];goldenAutoBuild($db,$cfg,fn($id)=>null,$stub);
    verify($asked===[]&&$job('N1')['auto_queued_at']===$n1['auto_queued_at'],'queued job is not checked or queued twice');
    goldenAutoBuild($db,$cfg,fn($id)=>null,function($rid){throw new RuntimeException('higgsfield down');});
    $put(['id'=>'N4','voice'=>'native','auto_build'=>true,'request_id'=>'r4','status'=>'queued']);
    goldenAutoBuild($db,$cfg,fn($id)=>null,function($rid){throw new RuntimeException('higgsfield down');});
    verify(str_contains($job('N4')['error'],'higgsfield down')&&empty($job('N4')['finish_status']),'failed status check is recorded and retried next run');

    // Captions from the video's own speech: two "sentences" of tone separated by a pause.
    $mp4="$dir/master.mp4";
    exec('/usr/bin/ffmpeg -v error -f lavfi -i "color=c=gray:s=320x568:d=8" -f lavfi -i "sine=frequency=220:duration=3" -f lavfi -i "anullsrc=r=44100:cl=mono:d=0.8" -f lavfi -i "sine=frequency=330:duration=3" -filter_complex "[1][2][3]concat=n=3:v=0:a=1[a]" -map 0:v -map "[a]" -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac '.escapeshellarg($mp4),$o,$rc);
    if($rc!==0||!is_file($mp4)){echo "SKIP caption timing (ffmpeg could not make test video)\n";}
    else{
        require_once __DIR__.'/../private/finishing.php';
        $srt=goldenNativeCaptions($cfg,['script'=>'Take a look at this 2013 SUBARU XV CROSSTREK. Just $14,688.','vehicle'=>'2013 SUBARU XV CROSSTREK','duration'=>30],$mp4,$dir);
        preg_match_all('/(\d\d):(\d\d):(\d\d),(\d{3}) -->/',$srt,$m,PREG_SET_ORDER);
        $starts=array_map(fn($x)=>(int)$x[3]+(int)$x[4]/1000,$m);
        $srt2=goldenNativeCaptions($cfg,['script'=>'Visit Golden Auto in San Ramon today.','vehicle'=>'','duration'=>30],$mp4,$dir);
        verify(str_contains(str_replace("\n",' ',$srt2),'San Ramon'),'"San Ramon" is never split across captions');
        $srt4=goldenNativeCaptions($cfg,['script'=>'Take a look at this 2013 SUBARU XV CROSSTREK PREMIUM, here at Golden Auto. Just $14,688.','vehicle'=>'2013 SUBARU XV CROSSTREK','duration'=>30],$mp4,$dir);
        verify(str_contains(str_replace("\n",' ',$srt4),'XV Crosstrek Premium,'),'trim stays with the car name and the comma ends the caption');
        verify(str_contains(str_replace("\n",' ',$srt),'Subaru XV Crosstrek')&&str_contains($srt,'Just $14,688.'),'captions use display wording');
        verify(count($starts)>=2&&$starts[0]<0.5&&abs(end($starts)-3.8)<0.4,'second sentence caption starts at the measured pause');
        $srt3=goldenNativeCaptions($cfg,['script'=>'Take a look at this 2013 SUBARU XV CROSSTREK. Just $14,688.','vehicle'=>'2013 SUBARU XV CROSSTREK','duration'=>30],$mp4,$dir,NARRATION_OFFSET);
        preg_match('/(\d\d):(\d\d):(\d\d),(\d{3}) -->/',$srt3,$m3);
        verify(abs(((int)$m3[3]+(int)$m3[4]/1000)-($starts[0]+NARRATION_OFFSET))<0.01,'narration captions shifted by the audio offset');
        verify(goldenHeardWords([],"$dir/speech.wav",$dir)===[]&&goldenHeardWords(['whisper_cli'=>"$dir/missing",'whisper_model'=>"$dir/missing.bin"],"$dir/speech.wav",$dir)===[],'no speech recognition configured: captions use pause timing');
        file_put_contents("$dir/captions.srt",$srt);
    }
}finally{
    foreach([...glob("$dir/data/*"),...glob("$dir/*.*")] as $f)if(is_file($f))unlink($f);
    @rmdir("$dir/data");@rmdir("$dir/assets");@rmdir($dir);
}
