<?php
// Parity harness: runs the PHP originals on the cases Node sends (JSON on stdin) and prints the results as JSON.
// Pure functions only; nothing here touches the network, the database or a paid API.
declare(strict_types=1);
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
require __DIR__.'/../../../private/app.php';
require_once __DIR__.'/../../../private/clients.php';
const ALLOWED=['integerWords','currencyWords','numberSpeech','priceSpeech','speechWordCount','speechScript','nativeSpeech',
 'seedanceRespell','acronymSpeech','captionDisplayText','captionSyllables','captionUnits','captionWrap','captionCues',
 'captionWordKey','captionWordsMatch','captionAlignWords','captionSpokenScript','captionStripExtra','captionSegments',
 'captionVoicedTime','captionSrt','captionDraft','validateSrt','srtTime','highestPrice','money','adPrice','title','script','script30',
 'speechClientSites','shorthandSpeech','captionCallForPrice','priceMatches','clientWebsiteSpoken','clientDetails',
 'clientInventoryKey','clientWebsite','html_entity_decode','parityParseUrl','parityClientAnalyze','parityClientAdd','paritySaveDetails'];
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
