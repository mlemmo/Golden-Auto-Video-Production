<?php
require __DIR__.'/../private/app.php';
$cfg=['public_base_url'=>'http://127.0.0.1:4343','allow_local_http'=>true];
if(validateAppBase($cfg)!=='http://127.0.0.1:4343')throw new RuntimeException('Local base rejected');
if(referenceImageUrl('http://127.0.0.1:4343/assets/spokesperson.png',$cfg)!=='http://127.0.0.1:4343/assets/spokesperson.png')throw new RuntimeException('Local image rejected');
foreach([['public_base_url'=>'http://127.0.0.1:4343','allow_local_http'=>false],['public_base_url'=>'http://192.168.1.2:4343','allow_local_http'=>true],['public_base_url'=>'http://127.0.0.1:9999','allow_local_http'=>true]]as $bad){try{validateAppBase($bad);throw new LogicException('Unsafe base accepted');}catch(RuntimeException $e){}}
try{referenceImageUrl('http://127.0.0.1:4343/assets/../config.php',$cfg);throw new LogicException('Traversal accepted');}catch(RuntimeException $e){}
echo "PASS Ubuntu loopback port, image reference, HTTP restrictions and traversal checks\n";
