<?php
declare(strict_types=1);
require __DIR__.'/../private/app.php';require __DIR__.'/../private/spokespersons.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$dir=sys_get_temp_dir().'/ga-spokes-'.bin2hex(random_bytes(4));mkdir($dir.'/assets',0700,true);mkdir($dir.'/data',0700);
$png=base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxkAAAAASUVORK5CYII=');
file_put_contents($dir.'/assets/spokesperson.png',$png);
$cfg=['asset_dir'=>$dir.'/assets','data_dir'=>$dir.'/data','public_base_url'=>'https://example.com:4343'];
try{
    $db=db($cfg);
    $lib=spokespersonApi('spokesperson_list',[],$cfg,$db);
    verify(count($lib['items'])===1&&$lib['items'][0]['file']==='spokesperson.png'&&$lib['default']===$lib['items'][0]['id'],'original spokesperson.png registered as default');
    verify($lib['items'][0]['url']==='https://example.com:4343/assets/spokesperson.png','public URL built from app base');
    verify(referenceImageUrl($lib['items'][0]['url'],$cfg)===$lib['items'][0]['url'],'spokesperson URL accepted as a reference');
    verify(count(spokespersonApi('spokesperson_list',[],$cfg,$db)['items'])===1,'seeding runs once');

    // Simulate an uploaded spokesperson (move_uploaded_file cannot run outside a request).
    file_put_contents($dir.'/assets/spokesperson-abc123.png',$png);
    $saved=state($db,'spokespersons');$saved['items'][]=['id'=>'abc123','name'=>'Dan','description'=>'friendly adult man age 40, navy blazer','file'=>'spokesperson-abc123.png','created_at'=>gmdate('c')];save($db,'spokespersons',$saved);
    verify(spokespersonFind($db,$cfg,'abc123')['name']==='Dan','find by id');
    try{spokespersonFind($db,$cfg,'missing');verify(false,'unknown id rejected');}catch(RuntimeException $e){verify(true,'unknown id rejected');}
    $lib=spokespersonApi('spokesperson_default',['id'=>'abc123'],$cfg,$db);verify($lib['default']==='abc123','default can be changed');
    $lib=spokespersonApi('spokesperson_delete',['id'=>'abc123'],$cfg,$db);
    verify(count($lib['items'])===1&&$lib['default']===$lib['items'][0]['id'],'delete falls back to remaining default');
    verify(!is_file($dir.'/assets/spokesperson-abc123.png'),'uploaded image removed on delete');
    spokespersonApi('spokesperson_delete',['id'=>$lib['items'][0]['id']],$cfg,$db);
    verify(is_file($dir.'/assets/spokesperson.png'),'original spokesperson.png kept on disk after delete');
    try{spokespersonClean('Say "buy now"',300,'description');verify(false,'quotes rejected');}catch(RuntimeException $e){verify(true,'double quotes rejected from prompt text');}

    $v=['Year'=>2013,'Make'=>'SUBARU','Model'=>'XV CROSSTREK'];
    foreach(['showroom','dynamic'] as $style){
        $p=prompt($v,'Visit us.',$style,15,'friendly adult man age 40, navy blazer.');
        verify(str_contains($p,'friendly adult man age 40, navy blazer')&&!str_contains($p,'woman age 28')&&!str_contains($p,'She '),$style.' prompt uses chosen spokesperson description');
    }
    verify(str_contains(prompt($v,'Visit us.','showroom'),SPOKESPERSON_DEFAULT_DESCRIPTION),'default description when none given');
}finally{
    foreach(glob($dir.'/{assets,data}/*',GLOB_BRACE) as $f)unlink($f);rmdir($dir.'/assets');rmdir($dir.'/data');rmdir($dir);
}
