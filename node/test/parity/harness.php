<?php
// Parity harness: runs the PHP originals on the cases Node sends (JSON on stdin) and prints the results as JSON.
// Pure functions only; nothing here touches the network, the database or a paid API.
declare(strict_types=1);
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
require __DIR__.'/../../../private/app.php';
require_once __DIR__.'/../../../private/clients.php';
require_once __DIR__.'/../../../private/importers.php';
require_once __DIR__.'/../../../private/dealercenter_sync.php';
const ALLOWED=['integerWords','currencyWords','numberSpeech','priceSpeech','speechWordCount','speechScript','nativeSpeech',
 'seedanceRespell','acronymSpeech','captionDisplayText','captionSyllables','captionUnits','captionWrap','captionCues',
 'captionWordKey','captionWordsMatch','captionAlignWords','captionSpokenScript','captionStripExtra','captionSegments',
 'captionVoicedTime','captionSrt','captionDraft','validateSrt','srtTime','highestPrice','money','adPrice','title','script','script30',
 'speechClientSites','shorthandSpeech','captionCallForPrice','priceMatches','clientWebsiteSpoken','clientDetails',
 'clientInventoryKey','clientWebsite','html_entity_decode','parityParseUrl','parityClientAnalyze','parityClientAdd','paritySaveDetails','dcsParseVdp','parityImportDcs','jsonp','parityGoldenInventory','parityImportMedia','strip_tags','strnatcasecmp','parityFilterInt','dcNormalize','dcCleanDescription','parityDcSync'];
// Fixture wrappers: the same inputs Node gets, with a fake website and an in-memory database (no network, no files).
function parityDb():PDO{$db=new PDO('sqlite::memory:');$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
    $db->exec('CREATE TABLE state (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE jobs (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE, payload TEXT NOT NULL)');return $db;}
function parityFetch(array $pages):callable{return function(string $url)use($pages){$p=$pages[$url]??null;
    return $p?['code'=>(int)$p['code'],'body'=>(string)($p['body']??''),'url'=>$url,'headers'=>(string)($p['headers']??'')]:['code'=>404,'body'=>'','url'=>$url,'headers'=>''];};}
function parityParseUrl(string $u){$p=parse_url($u);if($p===false)return false;return array_intersect_key($p,['scheme'=>1,'user'=>1,'pass'=>1,'host'=>1,'port'=>1]);}
function parityClientAnalyze(string $website,array $pages):array{$a=clientAnalyze($website,parityFetch($pages));unset($a['checked_at']);return $a;}
function parityClientAdd(array $items,string $name,string $website,array $pages):array{$db=parityDb();if($items)save($db,'clients',['items'=>$items]);
    $c=clientAdd($db,$name,$website,parityFetch($pages));unset($c['created_at'],$c['analysis']['checked_at']);return ['client'=>$c,'ids'=>array_column(clientsLoad($db)['items'],'id')];}
function paritySaveDetails(string $id,array $input):array{$db=parityDb();save($db,'clients',['items'=>[['id'=>'golden-auto','name'=>'Golden Auto','website'=>'https://www.mygoldenauto.net'],['id'=>'x','name'=>'X Motors','website'=>'https://x.com']]]);
    $c=clientSaveDetails($db,$id,$input);return [$c,state($db,'clients')];}
$cases=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);$out=[];
foreach($cases as $c){
    if(!in_array($c['fn'],ALLOWED,true)){$out[]=['error'=>'not allowed'];continue;}
    speechSites($c['sites']??[]);  // the client websites said in words for this case (none by default)
    try{$out[]=['ok'=>($c['fn'])(...$c['args'])];}catch(Throwable $e){$out[]=['error'=>$e->getMessage()];}
}
echo json_encode($out,JSON_THROW_ON_ERROR|JSON_PRESERVE_ZERO_FRACTION|JSON_INVALID_UTF8_SUBSTITUTE);
/** Two imports in a row against a fake site (the second after the site changed); timestamps removed. */
function parityImportDcs(array $client,array $first,array $second,array $prior):array{$db=parityDb();
    save($db,'clients',['items'=>[['id'=>'golden-auto','name'=>'Golden Auto','website'=>'https://www.mygoldenauto.net'],$client]]);
    if($prior)save($db,clientInventoryKey($client['id']),['vehicles'=>$prior]);$out=[];
    foreach([$first,$second] as $pages){try{$r=clientImportDcs($db,[],$client,parityFetch($pages));$out[]=$r['report'];}catch(Throwable $e){$out[]=['error'=>$e->getMessage()];}}
    $inv=state($db,clientInventoryKey($client['id']));if($inv){unset($inv['checked_at']);foreach($inv['vehicles'] as &$v)unset($v['imported_at'],$v['detail_checked_at']);}
    return ['reports'=>$out,'inventory'=>$inv,'dealer'=>clientFind($db,$client['id'])['dealer']??null];}
function parityGoldenInventory(string $source,array $pages):array{return inventory($source,function(string $u)use($pages){
    if(!isset($pages[$u]))throw new RuntimeException('Remote request failed (HTTP 404).');return (string)$pages[$u];});}
/** importMediaZip() on a ZIP of the given entries (name => 'jpg'|'png'|'big'|'bad', images passed as base64). */
function parityImportMedia(array $fields,array $files,array $img):array{
    $dir=sys_get_temp_dir().'/ga-pim-'.bin2hex(random_bytes(4));mkdir($dir);$zip=$dir.'/m.zip';$z=new ZipArchive;$z->open($zip,ZipArchive::CREATE);
    foreach($files as $name=>$kind)$z->addFromString((string)$name,$kind==='bad'?'not an image':base64_decode($img[$kind]));$z->close();
    $cfg=['asset_dir'=>$dir.'/assets','public_base_url'=>'https://node.example.com:4343'];
    try{$v=importMediaZip($zip,$fields,$cfg);$sizes=[];foreach($v['photos'] as $u){$s=getimagesize($cfg['asset_dir'].'/'.basename($u));$sizes[]=[$s[0],$s[1],$s['mime']];}
        $v['photos']=$sizes;unset($v['imported_at'],$v['detail_checked_at']);return $v;}
    finally{foreach(glob($dir.'/assets/*')?:[] as $f)unlink($f);@rmdir($dir.'/assets');unlink($zip);rmdir($dir);}}
function parityFilterInt(mixed $v):mixed{return filter_var($v,FILTER_VALIDATE_INT);}
/** A run of dcSync calls. steps: [{snapshot, zips:{stock:n}, fail:[cdn ids that fail to download]}], prior inventory. */
function parityDcSync(array $prior,array $steps,string $jpg):array{
    $dir=sys_get_temp_dir().'/ga-pdc-'.bin2hex(random_bytes(4));foreach(['assets','zips'] as $d)mkdir("$dir/$d",0700,true);
    $cfg=['asset_dir'=>"$dir/assets",'public_base_url'=>'https://node.example.com:4343'];$db=parityDb();
    if($prior)save($db,'inventory',['vehicles'=>$prior]);$out=[];
    try{foreach($steps as $st){
        foreach(glob("$dir/zips/*")?:[] as $f)unlink($f);
        foreach($st['zips'] as $stock=>$n){$z=new ZipArchive;$z->open("$dir/zips/$stock.zip",ZipArchive::CREATE);for($i=1;$i<=$n;$i++)$z->addFromString("p$i.jpg",base64_decode($jpg));$z->close();}
        $fail=$st['fail'];$dl=function(array $urls)use($fail,$jpg){$o=[];foreach($urls as $i=>$u){$id=basename($u,'.jpg');if(!in_array($id,$fail,true))$o[$i]=base64_decode($jpg);}return $o;};
        try{$log=dcSync($db,$cfg,$st['snapshot'],"$dir/zips",$dl);unset($log['at']);$r=['log'=>$log];}catch(Throwable $e){$r=['error'=>$e->getMessage()];}
        $inv=state($db,'inventory');
        if($inv){unset($inv['dealercenter_checked_at']);foreach($inv['vehicles'] as &$v){$v['photos']=count($v['photos']??[]);foreach(['imported_at','detail_checked_at','dc_checked_at','price_changed_at','removed_at'] as $k)if(isset($v[$k]))$v[$k]='set';unset($v['original_filenames']);}unset($v);}
        $sheets=[];foreach($db->query("SELECT id,payload FROM state WHERE id LIKE 'sheet:%' ORDER BY id") as $row){$sh=json_decode($row['payload'],true);$sheets[$row['id']]=$sh['photo_count'];}
        $r['inventory']=$inv;$r['sheets']=$sheets;$r['files']=count(glob("$dir/assets/*.jpg"));$r['log_entries']=count(state($db,'sync_log')['entries']??[]);$out[]=$r;}}
    finally{foreach(['assets','zips'] as $d){foreach(glob("$dir/$d/*")?:[] as $f)unlink($f);rmdir("$dir/$d");}rmdir($dir);}
    return $out;}
