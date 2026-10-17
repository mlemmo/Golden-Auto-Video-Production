<?php
// Parity harness: runs the PHP originals on the cases Node sends (JSON on stdin) and prints the results as JSON.
// Pure functions only; nothing here touches the network, the database or a paid API.
declare(strict_types=1);
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
require __DIR__.'/../../../private/app.php';
const ALLOWED=['integerWords','currencyWords','numberSpeech','priceSpeech','speechWordCount','speechScript','nativeSpeech',
 'seedanceRespell','acronymSpeech','captionDisplayText','captionSyllables','captionUnits','captionWrap','captionCues',
 'captionWordKey','captionWordsMatch','captionAlignWords','captionSpokenScript','captionStripExtra','captionSegments',
 'captionVoicedTime','captionSrt','captionDraft','validateSrt','srtTime','highestPrice','money','adPrice','title','script','script30'];
$cases=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);$out=[];
foreach($cases as $c){
    if(!in_array($c['fn'],ALLOWED,true)){$out[]=['error'=>'not allowed'];continue;}
    try{$out[]=['ok'=>($c['fn'])(...$c['args'])];}catch(Throwable $e){$out[]=['error'=>$e->getMessage()];}
}
echo json_encode($out,JSON_THROW_ON_ERROR|JSON_PRESERVE_ZERO_FRACTION|JSON_INVALID_UTF8_SUBSTITUTE);
