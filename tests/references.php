<?php
require __DIR__.'/../private/app.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$dir=sys_get_temp_dir().'/golden-ref-test-'.bin2hex(random_bytes(5));mkdir($dir);
file_put_contents($dir.'/avatar.png',base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxkAAAAASUVORK5CYII='));
$cfg=['asset_dir'=>$dir,'public_base_url'=>'https://example.com/studio','higgsfield_key'=>'test-placeholder'];$calls=[];
$mock=function($method,$url,$headers,$body)use(&$calls){$calls[]=[$method,$url,$headers,$body];if($method==='POST')return json_encode(['upload_url'=>'https://storage.example.com/signed','public_url'=>'https://cdn.example.com/image.png','upload_headers'=>['Content-Type'=>'image/png','x-amz-tagging'=>'retention=temporary']]);return '';};
try{
 $result=uploadReference('https://example.com/studio/assets/avatar.png',$cfg,$mock);
 verify($result==='https://cdn.example.com/image.png','hosted URL returned after successful PUT');
 verify(count($calls)===2 && $calls[0][0]==='POST' && $calls[1][0]==='PUT','POST then PUT sequence');
 verify(json_decode($calls[0][3],true)['content_type']==='image/png','PNG MIME used for upload request');
 verify($calls[1][2]===['Content-Type: image/png','x-amz-tagging: retention=temporary'],'all storage headers and no API credentials');
 verify($calls[1][3]===file_get_contents($dir.'/avatar.png'),'actual file bytes uploaded');
 verify(speechScript('Visit Golden Auto in San Ramon.')==='Visit Golden Auto in San Ramon.','narration says San Ramon');
 $walk=prompt(['Year'=>2013,'Make'=>'SUBARU','Model'=>'XV CROSSTREK'],'Visit San Ramon. A great SUV.','showroom',30);
 verify(!str_contains($walk,'Visit San Ramon')&&str_contains($walk,'walks slowly forward')&&str_contains($walk,'side nearest the camera')&&str_contains($walk,'no watermark'),'walkaround prompt: spokesperson walks the near side, no spoken script, no text');
 try{referenceFile('https://example.com/studio/assets/../config.php',$cfg);throw new LogicException('Traversal accepted');}catch(RuntimeException $e){verify(true,'path traversal rejected');}
 $fail=function($method,$url,$headers,$body)use($mock){if($method==='PUT')throw new RuntimeException('PUT rejected');return $mock($method,$url,$headers,$body);};
 try{uploadReference('https://example.com/studio/assets/avatar.png',$cfg,$fail);throw new LogicException('Failed PUT accepted');}catch(RuntimeException $e){verify($e->getMessage()==='PUT rejected','failed PUT stops before generation');}
 verify(!str_contains(jobError('Failure at https://storage.example.com/?secret=test'),'secret'),'signed URLs omitted from displayed errors');
}finally{unlink($dir.'/avatar.png');rmdir($dir);}
