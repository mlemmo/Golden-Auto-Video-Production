<?php
declare(strict_types=1);
// No paid API calls: only the delete actions run.
require __DIR__.'/../private/app.php';require __DIR__.'/../private/narrations.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$dir=sys_get_temp_dir().'/ga-ndel-'.bin2hex(random_bytes(4));mkdir("$dir/assets/narrations",0700,true);mkdir("$dir/data",0700);
$cfg=['asset_dir'=>"$dir/assets",'data_dir'=>"$dir/data",'public_base_url'=>'https://example.com:4343'];
$db=db($cfg);narrationTables($db);
$put=function(string $table,array $r)use($db){$q=$db->prepare("INSERT INTO $table VALUES (?,?,?)");$q->execute([$r['id'],null,json_encode($r)]);};
$mp3=function(string $id)use($dir){$f="$dir/assets/narrations/$id.mp3";file_put_contents($f,'x');return $f;};
$expectError=function(callable $f,string $text,string $name){try{$f();verify(false,$name);}catch(RuntimeException $e){verify(str_contains($e->getMessage(),$text),$name);}};
try{
    $free=str_repeat('a',32);$put('narrations',['id'=>$free,'status'=>'ready','audio_name'=>"$free.mp3"]);$f1=$mp3($free);
    narrationApi('narration_delete',['id'=>$free],$cfg,$db);
    verify(!is_file($f1)&&$db->query('SELECT COUNT(*) FROM narrations')->fetchColumn()==0,'unused preview and its audio deleted');

    $busy=str_repeat('b',32);$put('narrations',['id'=>$busy,'status'=>'submitting']);
    $expectError(fn()=>narrationApi('narration_delete',['id'=>$busy],$cfg,$db),'still being created','preview being created cannot be deleted');

    $used=str_repeat('c',32);$put('narrations',['id'=>$used,'status'=>'ready','audio_name'=>"$used.mp3"]);$f2=$mp3($used);
    $wav=str_repeat('d',32).'.wav';file_put_contents("$dir/assets/narrations/$wav",'w');
    $put('narration_lipsync',['id'=>'L1','narration_id'=>$used,'status'=>'queued','audio_file'=>$wav]);
    $expectError(fn()=>narrationApi('narration_delete',['id'=>$used],$cfg,$db),'Delete that lip-sync job first','preview used by lip-sync is protected');
    $expectError(fn()=>narrationApi('narration_lipsync_delete',['id'=>'L1'],$cfg,$db),'still running','running lip-sync cannot be deleted');

    $db->prepare('UPDATE narration_lipsync SET payload=? WHERE id=?')->execute([json_encode(['id'=>'L1','narration_id'=>$used,'status'=>'completed','audio_file'=>$wav]),'L1']);
    $put('jobs',['id'=>'L1','narration_id'=>$used,'status'=>'completed','provider'=>'fal_lipsync']);
    $r=narrationApi('narration_lipsync_delete',['id'=>'L1'],$cfg,$db);
    verify(str_contains($r['message'],'stays in Video jobs')&&!is_file("$dir/assets/narrations/$wav"),'finished lip-sync job and padded audio deleted');
    $expectError(fn()=>narrationApi('narration_delete',['id'=>$used],$cfg,$db),'cannot be deleted','preview behind a lip-synced video stays');
    verify(is_file($f2),'protected preview audio kept');

    $failed=str_repeat('e',32);$put('narrations',['id'=>$failed,'status'=>'ready','audio_name'=>"$failed.mp3"]);$mp3($failed);
    $put('narration_lipsync',['id'=>'L2','narration_id'=>$failed,'status'=>'failed']);
    narrationApi('narration_delete',['id'=>$failed],$cfg,$db);verify(true,'preview whose only lip-sync failed can be deleted');
    $expectError(fn()=>narrationApi('narration_delete',['id'=>'missing'],$cfg,$db),'not found','unknown preview rejected');
}finally{
    foreach(glob("$dir/assets/narrations/*") as $f)unlink($f);foreach(glob("$dir/data/*") as $f)unlink($f);
    rmdir("$dir/assets/narrations");rmdir("$dir/assets");rmdir("$dir/data");rmdir($dir);
}
