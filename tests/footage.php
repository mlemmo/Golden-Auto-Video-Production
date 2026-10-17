<?php
declare(strict_types=1);
// "My footage" jobs: upload checks and the finished-video job. No paid API calls; ffprobe and the upload move are faked.
require __DIR__.'/../private/app.php';require __DIR__.'/../private/narrations.php';require __DIR__.'/../private/footage.php';require __DIR__.'/../private/jobs.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$dir=sys_get_temp_dir().'/ga-foot-'.bin2hex(random_bytes(4));mkdir("$dir/assets/narrations",0700,true);mkdir("$dir/data",0700);
$cfg=['asset_dir'=>"$dir/assets",'data_dir'=>"$dir/data",'public_base_url'=>'https://example.com:4343'];
$db=db($cfg);narrationTables($db);
$expectError=function(callable $f,string $text,string $name){try{$f();verify(false,$name);}catch(RuntimeException $e){verify(str_contains($e->getMessage(),$text),$name.' ('.$e->getMessage().')');}};
try{
    save($db,'inventory',['vehicles'=>[['StockNumber'=>'870288','Year'=>2013,'Make'=>'SUBARU','Model'=>'XV CROSSTREK','price'=>14688.25,'Vin'=>'V1']]]);
    $mp3=str_repeat('a',32).'.mp3';file_put_contents("$dir/assets/narrations/$mp3",'voice');
    $voice=['id'=>'N1','stock'=>'870288','price'=>14688.25,'status'=>'ready','approved'=>true,'duration'=>30,'audio_duration'=>24.3,
        'audio_name'=>$mp3,'audio_hash'=>hash_file('sha256',"$dir/assets/narrations/$mp3"),'text'=>'spoken words','caption_script'=>'Caption words.'];
    $q=$db->prepare('INSERT INTO narrations VALUES (?,?,?)');$q->execute(['N1',null,json_encode($voice)]);
    $tmp="$dir/upload.tmp";file_put_contents($tmp,'video bytes');
    $file=['name'=>'walkaround.MOV','tmp_name'=>$tmp,'size'=>11,'error'=>UPLOAD_ERR_OK];
    $probe=fn(float $sec,int $w=1080,int $h=1920,string $fmt='mov,mp4,m4a,3gp,3g2,mj2')=>fn($p)=>['duration'=>$sec,'width'=>$w,'height'=>$h,'format'=>$fmt];
    $move=fn($from,$to)=>copy($from,$to);
    $in=['stock'=>'870288','format'=>'instagram_reels','narration_id'=>'N1','confirm_current'=>'1'];

    $expectError(fn()=>goldenFootageBuild($db,$cfg,['confirm_current'=>false]+$in,$file,$probe(40),$move),'Confirm the vehicle','availability and price must be confirmed');
    $expectError(fn()=>goldenFootageBuild($db,$cfg,['narration_id'=>'missing']+$in,$file,$probe(40),$move),'not found','unknown voice preview rejected');
    $expectError(fn()=>goldenFootageBuild($db,$cfg,$in,['name'=>'car.avi']+$file,$probe(40),$move),'MP4 or MOV','other file types rejected');
    $expectError(fn()=>goldenFootageBuild($db,$cfg,$in,$file,$probe(40,1080,1920,'avi'),$move),'MP4 or MOV','renamed non-MP4 file rejected by its contents');
    $expectError(fn()=>goldenFootageBuild($db,$cfg,$in,$file,$probe(20),$move),'needs at least 25.3 s','footage shorter than the voice rejected');
    $expectError(fn()=>goldenFootageBuild($db,$cfg,$in,['size'=>70*1024*1024]+$file,$probe(40),$move),'64 MB','over 64 MB rejected');
    $expectError(fn()=>goldenFootageBuild($db,$cfg,$in,['error'=>UPLOAD_ERR_INI_SIZE]+$file,$probe(40),$move),'Upload failed','PHP upload error explained');
    verify((int)$db->query('SELECT COUNT(*) FROM jobs')->fetchColumn()===0&&!is_dir("$dir/assets/footage")||count(glob("$dir/assets/footage/*"))===0,'nothing saved when checks fail');

    $job=goldenFootageBuild($db,$cfg,$in,$file,$probe(41.7),$move);
    verify($job['provider']==='footage'&&$job['status']==='completed'&&$job['finish_status']==='queued'&&$job['audio_swap']===true&&$job['captions_from_audio']===true,'job goes straight to the caption worker with the approved voice swapped in');
    verify($job['script']==='Caption words.'&&$job['narration_id']==='N1'&&$job['duration']===30,'captions use the approved caption text; trimmed to the video length');
    verify(preg_match('/^[a-f0-9]{32}\.mov$/',$job['footage_file'])===1&&is_file(footageLocalPath($cfg,$job)),'footage stored under a random name');
    $short=goldenFootageBuild($db,$cfg,$in,$file,$probe(27.4),$move);
    verify($short['duration']===27,'footage shorter than 30 s: video ends with the footage');
    $expectError(fn()=>footageLocalPath($cfg,['footage_file'=>'../x.mov']),'missing','path tricks rejected');

    // A car with no advertised price ("Call For Price") works when its voice preview was also made without a price.
    $inv=state($db,'inventory');$inv['vehicles'][]=['StockNumber'=>'0939','Year'=>2016,'Make'=>'LAND ROVER','Model'=>'RANGE ROVER SPORT','price'=>null,'Vin'=>'V2'];save($db,'inventory',$inv);
    $q=$db->prepare('INSERT INTO narrations VALUES (?,?,?)');$q->execute(['N2',null,json_encode(['id'=>'N2','stock'=>'0939','price'=>null]+$voice)]);
    $np=goldenFootageBuild($db,$cfg,['stock'=>'0939','narration_id'=>'N2']+$in,$file,$probe(40),$move);
    verify($np['price']===null&&$np['stock']==='0939','no-price car: footage video can be built');
    goldenJobDelete($db,$cfg,$job['id']);
    verify(!is_file("$dir/assets/footage/".$job['footage_file']),'deleting the video removes its uploaded footage');
}finally{
    foreach([...glob("$dir/assets/footage/*"),...glob("$dir/assets/narrations/*"),...glob("$dir/data/*"),...glob("$dir/*.tmp")] as $f)if(is_file($f))unlink($f);
    @rmdir("$dir/assets/footage");@rmdir("$dir/assets/narrations");@rmdir("$dir/assets");@rmdir("$dir/data");@rmdir($dir);
}
