<?php
declare(strict_types=1);
// No paid API calls: lip-sync polling is stubbed; caption timing runs on a generated test tone.
require __DIR__.'/../private/app.php';require __DIR__.'/../private/auto_build.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$dir=sys_get_temp_dir().'/ga-auto-'.bin2hex(random_bytes(4));mkdir("$dir/assets/narrations",0700,true);mkdir("$dir/data",0700);
$cfg=['asset_dir'=>"$dir/assets",'data_dir'=>"$dir/data",'public_base_url'=>'https://example.com:4343','ffmpeg_path'=>'/usr/bin/ffmpeg'];
$db=db($cfg);narrationTables($db);
$put=function(string $table,array $r)use($db){$q=$db->prepare("INSERT INTO $table VALUES (?,?,?)");$q->execute([$r['id'],null,json_encode($r)]);};
$job=fn(string $id)=>json_decode($db->query("SELECT payload FROM jobs WHERE id='$id'")->fetchColumn(),true);
try{
    // Vehicle with one local photo for the closing card.
    $im=imagecreatetruecolor(160,120);imagefill($im,0,0,imagecolorallocate($im,90,90,90));$photo=str_repeat('a',40).'.jpg';imagejpeg($im,"$dir/assets/$photo");imagedestroy($im);
    save($db,'inventory',['vehicles'=>[['StockNumber'=>'S1','Vin'=>'stock:S1','Year'=>2013,'Make'=>'SUBARU','Model'=>'XV CROSSTREK','price'=>14688.0,'photos'=>["https://example.com:4343/assets/$photo"]]]]);

    // Polling: only auto-build lip-syncs still at fal are checked.
    $put('narration_lipsync',['id'=>'L1','auto_build'=>true,'request_id'=>'r1','status'=>'queued']);
    $put('narration_lipsync',['id'=>'L2','auto_build'=>false,'request_id'=>'r2','status'=>'queued']);
    $put('narration_lipsync',['id'=>'L3','auto_build'=>true,'request_id'=>'r3','status'=>'completed']);
    $polled=[];goldenAutoBuild($db,$cfg,function($id)use(&$polled){$polled[]=$id;});
    verify($polled===['L1'],'only running auto-build lip-sync jobs are checked');
    goldenAutoBuild($db,$cfg,function($id){throw new RuntimeException('fal unreachable');});
    verify(str_contains(narrationLoad($db,'narration_lipsync','L1')['error'],'fal unreachable'),'failed status check is recorded, job kept for next run');

    // A finished auto-build video without a usable narration stops with a clear reason.
    $put('jobs',['id'=>'J1','auto_build'=>true,'provider'=>'fal_lipsync','status'=>'completed','video_url'=>'https://v.example/x.mp4','stock'=>'S1','vehicle'=>'2013 SUBARU XV CROSSTREK','price'=>14688.0,'duration'=>15,'script'=>'Just $14,688.','narration_id'=>'missing']);
    $put('jobs',['id'=>'J2','auto_build'=>false,'provider'=>'fal_lipsync','status'=>'completed','video_url'=>'https://v.example/y.mp4','narration_id'=>'missing']);
    goldenAutoBuild($db,$cfg,fn($id)=>null);
    verify($job('J1')['finish_status']==='failed'&&str_contains($job('J1')['finish_error'],'Automatic build stopped'),'build failure shown on the job');
    verify(!isset($job('J2')['finish_status']),'manual lip-sync videos are left for manual finishing');

    // Full path with real caption timing: approved narration audio → captions drafted → render queued.
    $mp3="$dir/assets/narrations/".str_repeat('b',32).'.mp3';
    exec('/usr/bin/ffmpeg -v error -f lavfi -i "sine=frequency=220:duration=3" -f lavfi -i "anullsrc=r=44100:cl=mono" -filter_complex "[0][1]concat=n=2:v=0:a=1[s];[s]atrim=0:4,asetpts=N/SR/TB" -t 4 '.escapeshellarg($mp3),$o,$rc);
    if($rc!==0||!is_file($mp3)){echo "SKIP full path (ffmpeg could not make test audio)\n";}
    else{
        $put('narrations',['id'=>'N1','status'=>'ready','approved'=>true,'audio_name'=>basename($mp3),'audio_hash'=>hash_file('sha256',$mp3),'caption_script'=>'Explore this SUBARU XV CROSSTREK. Just $14,688.']);
        $put('jobs',['id'=>'J3','auto_build'=>true,'provider'=>'fal_lipsync','status'=>'completed','video_url'=>'https://v.example/z.mp4','stock'=>'S1','vehicle'=>'2013 SUBARU XV CROSSTREK','price'=>14688.0,'duration'=>15,'format'=>'instagram_reels','script'=>'Explore this SUBARU XV CROSSTREK. Just $14,688.','narration_id'=>'N1']);
        goldenAutoBuild($db,$cfg,fn($id)=>null);$j3=$job('J3');
        verify(($j3['finish_status']??'')==='queued'&&!empty($j3['finishing_plan'])&&str_contains($j3['captions_srt'],'-->')&&str_contains($j3['captions_srt'],'$14,688'),'finished lip-sync is captioned and queued for the final render');
        goldenAutoBuild($db,$cfg,fn($id)=>null);
        verify($job('J3')['auto_queued_at']===$j3['auto_queued_at'],'queued job is not processed twice');
    }
}finally{
    foreach([...glob("$dir/assets/narrations/*"),...glob("$dir/assets/*.jpg"),...glob("$dir/data/*")] as $f)if(is_file($f))unlink($f);
    rmdir("$dir/assets/narrations");rmdir("$dir/assets");rmdir("$dir/data");rmdir($dir);
}
