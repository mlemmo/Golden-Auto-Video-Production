<?php
declare(strict_types=1);
function integerWords(int $n):string {
    if($n<0||$n>999999999)throw new RuntimeException('Price exceeds supported speech range.');
    $small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
    if($n<20)return $small[$n];$tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
    if($n<100)return $tens[intdiv($n,10)].($n%10?'-'.$small[$n%10]:'');
    foreach([1000000=>'million',1000=>'thousand',100=>'hundred']as $unit=>$label)if($n>=$unit)return integerWords(intdiv($n,$unit)).' '.$label.($n%$unit?' '.integerWords($n%$unit):'');
    return '';
}
function currencyWords(string $raw):string {
    $raw=str_replace(['$',',',' '],'',$raw);if(!preg_match('/^(\d{1,9})(?:\.(\d{1,2}))?$/',$raw,$m))throw new RuntimeException('Unsupported currency amount in script.');
    $d=(int)$m[1];$c=(int)str_pad($m[2]??'',2,'0');
    return integerWords($d).($d===1?' dollar':' dollars').($c?' and '.integerWords($c).($c===1?' cent':' cents'):'');
}
function priceSpeech(string $s):string {
    return preg_replace_callback('/\$(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d.,])(?:\s+dollars\b)?/i',fn($m)=>currencyWords($m[1]),$s);
}
function speechWordCount(string $s):int{return count(preg_split('/[\s-]+/u',speechScript($s),-1,PREG_SPLIT_NO_EMPTY));}
function srtTime(float $seconds):string {$ms=(int)round(max(0,$seconds)*1000);return sprintf('%02d:%02d:%02d,%03d',intdiv($ms,3600000),intdiv($ms%3600000,60000),intdiv($ms%60000,1000),$ms%1000);}
function captionDraft(string $script,float $duration):string {
    $tokens=preg_split('/\s+/u',trim(preg_replace('/\bSan\s+Ramon\b/i','the East Bay',$script)),-1,PREG_SPLIT_NO_EMPTY);if(!$tokens)return '';
    $chunks=array_chunk($tokens,5);$weights=[];$total=0;
    foreach($chunks as $chunk){$text=implode(' ',$chunk);$w=max(1,speechWordCount($text));$weights[]=$w;$total+=$w;}
    $start=.2;$usable=max(1,$duration-.6);$out='';foreach($chunks as $i=>$chunk){$end=$start+$usable*$weights[$i]/$total;$out.=($i+1)."\n".srtTime($start).' --> '.srtTime($end)."\n".implode(' ',$chunk)."\n\n";$start=$end;}return $out;
}
function validateSrt(string $s,float $duration):string {
    $s=str_replace(["\r\n","\r"],"\n",trim($s));if(strlen($s)>12000||!$s)throw new RuntimeException('Captions must be a non-empty SRT under 12 KB.');
    $previous=0;$blocks=preg_split('/\n\s*\n/',$s);if(count($blocks)>150)throw new RuntimeException('Too many caption cues.');
    foreach($blocks as $block){if(!preg_match('/^\d+\n(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})\n(.+)$/s',$block,$m))throw new RuntimeException('Invalid SRT cue. Keep the numbered timestamps and text.');
        foreach([2,3,6,7]as $i)if((int)$m[$i]>59)throw new RuntimeException('Invalid caption timestamp.');
        $a=(int)$m[1]*3600+(int)$m[2]*60+(int)$m[3]+(int)$m[4]/1000;$b=(int)$m[5]*3600+(int)$m[6]*60+(int)$m[7]+(int)$m[8]/1000;
        if($a<$previous||$b<=$a||$b>$duration+.5)throw new RuntimeException('Caption times overlap or exceed the requested video duration.');
        if(strlen($m[9])>500||preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/',$m[9]))throw new RuntimeException('Invalid caption text.');$previous=$b;
    }return $s."\n";
}
