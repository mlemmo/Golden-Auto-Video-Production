<?php
declare(strict_types=1);
// Native-voice Seedance path. No paid API calls: Higgsfield status is stubbed; captions are timed on a generated test video.
require __DIR__.'/../private/app.php';require __DIR__.'/../private/auto_build.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$v=['Year'=>2013,'Make'=>'SUBARU','Model'=>'XV CROSSTREK','price'=>14688.25];
$speech=nativeSpeech('Take a look at this 2013 SUBARU XV CROSSTREK here at Golden Auto in San Ramon. Just $14,688. Book your test drive at mygoldenauto.net.');
verify(str_contains($speech,'my golden auto dot net')&&!str_contains($speech,'N, E, T'),'website is said as "dot net" for the native voice');
$p=promptNative($v,$speech,30,'friendly woman, cream dress');
verify(str_contains($p,'word for word')&&str_contains($p,'"'.$speech.'"'),'prompt carries the exact spoken words');
verify(str_contains($p,'X-V')&&!str_contains($p,'$14,688'),'spoken words use the pronunciation form');
verify(str_contains($p,'rear three-quarter')&&str_contains($p,'No music'),'prompt sets the camera move and clean voice audio');
verify(str_contains($p,'always in the foreground, between the camera and the car')&&str_contains($p,'never behind the car'),'spokesperson stays in front of the car');
verify(str_contains($p,'"San Ramon" is pronounced san ruh-MOHN')&&str_contains($p,'never spelled out letter by letter'),'pronunciation guide for city and website');
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
    $asked=[];$stub=function($rid)use(&$asked){$asked[]=$rid;return ['status'=>'in_progress'];};
    goldenAutoBuild($db,$cfg,fn($id)=>null,$stub);
    verify($asked===['r1']&&$job('N1')['status']==='in_progress','only running native jobs are checked');
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
        verify(str_contains(str_replace("\n",' ',$srt),'Subaru XV Crosstrek')&&str_contains($srt,'Just $14,688.'),'captions use display wording');
        verify(count($starts)>=2&&$starts[0]<0.5&&abs(end($starts)-3.8)<0.4,'second sentence caption starts at the measured pause');
        file_put_contents("$dir/captions.srt",$srt);
    }
}finally{
    foreach([...glob("$dir/data/*"),...glob("$dir/*.*")] as $f)if(is_file($f))unlink($f);
    @rmdir("$dir/data");@rmdir("$dir/assets");@rmdir($dir);
}
