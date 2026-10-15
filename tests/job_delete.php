<?php
declare(strict_types=1);
// No paid API calls: only the delete action runs.
require __DIR__.'/../private/app.php';require __DIR__.'/../private/narrations.php';require __DIR__.'/../private/jobs.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$dir=sys_get_temp_dir().'/ga-jdel-'.bin2hex(random_bytes(4));mkdir("$dir/assets",0700,true);mkdir("$dir/data",0700);
$cfg=['asset_dir'=>"$dir/assets",'data_dir'=>"$dir/data",'public_base_url'=>'https://example.com:4343'];
$db=db($cfg);narrationTables($db);
$put=function(string $table,array $r)use($db){$q=$db->prepare("INSERT INTO $table VALUES (?,?,?)");$q->execute([$r['id'],null,json_encode($r)]);};
$count=fn()=>(int)$db->query('SELECT COUNT(*) FROM jobs')->fetchColumn();
$expectError=function(callable $f,string $text,string $name){try{$f();verify(false,$name);}catch(RuntimeException $e){verify(str_contains($e->getMessage(),$text),$name);}};
try{
    $file=str_repeat('e',40).'.mp4';file_put_contents("$dir/assets/$file",'v');
    $put('jobs',['id'=>'J1','status'=>'completed','finish_status'=>'completed','captioned_url'=>"https://example.com:4343/assets/$file"]);
    $r=goldenJobDelete($db,$cfg,'J1');
    verify($count()===0&&!is_file("$dir/assets/$file")&&str_contains($r['message'],'Higgsfield history'),'finished video and its captioned file deleted');

    $put('jobs',['id'=>'J2','status'=>'in_progress']);
    $expectError(fn()=>goldenJobDelete($db,$cfg,'J2'),'still being generated','video still generating is protected');
    $put('jobs',['id'=>'J3','status'=>'completed','finish_status'=>'rendering']);
    $expectError(fn()=>goldenJobDelete($db,$cfg,'J3'),'being captioned','video being captioned is protected');
    $put('jobs',['id'=>'J4','status'=>'completed']);$put('narration_lipsync',['id'=>'L1','source_video_id'=>'J4','status'=>'queued']);
    $expectError(fn()=>goldenJobDelete($db,$cfg,'J4'),'lip-sync job is still using','source of a running lip-sync is protected');
    $put('jobs',['id'=>'J5','status'=>'failed','captioned_url'=>'https://elsewhere.example/assets/../../x.mp4']);
    goldenJobDelete($db,$cfg,'J5');
    verify($count()===3,'failed video deleted; foreign URLs never touch local files');
    $expectError(fn()=>goldenJobDelete($db,$cfg,'missing'),'not found','unknown video reported');
}finally{
    foreach([...glob("$dir/assets/*"),...glob("$dir/data/*")] as $f)if(is_file($f))unlink($f);
    rmdir("$dir/assets");rmdir("$dir/data");rmdir($dir);
}
