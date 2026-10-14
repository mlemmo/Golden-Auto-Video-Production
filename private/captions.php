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
    // A sentence-ending period after the price ("Just $14,688.") must not block the conversion.
    return preg_replace_callback('/\$(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d,]|\.\d)(?:\s+dollars\b)?/i',fn($m)=>currencyWords($m[1]),$s);
}
function speechWordCount(string $s):int{return count(preg_split('/[\s-]+/u',speechScript($s),-1,PREG_SPLIT_NO_EMPTY));}
function srtTime(float $seconds):string {$ms=(int)round(max(0,$seconds)*1000);return sprintf('%02d:%02d:%02d,%03d',intdiv($ms,3600000),intdiv($ms%3600000,60000),intdiv($ms%60000,1000),$ms%1000);}
const CAPTION_MAX_LINE=24;
const CAPTION_MAX_CUE=40;
const CAPTION_GLUE=['this','the','a','an','your','at','to','in','of','for','on','with','and','or','our','my','from','by'];
const CAPTION_ACRONYMS=['SUV','AWD','FWD','RWD','4WD','GMC','BMW','CVT','TDI','TSI','WRX','STI','SRT','AMG','XLT','LED'];
/** Display text for captions: readable case, whole-dollar prices, spoken location match. */
function captionDisplayText(string $script):string {
    $s=trim(preg_replace('/\s+/u',' ',preg_replace('/\bSan\s+Ramon\b/i','the East Bay',$script)));
    $s=preg_replace('/(\$\d[\d,]*)\.00(?!\d)/','$1',$s);
    return preg_replace_callback('/(?<![A-Za-z0-9\-])[A-Z]{4,}(?![A-Za-z0-9\-])/',function($m){
        return in_array($m[0],CAPTION_ACRONYMS,true)?$m[0]:ucfirst(strtolower($m[0]));
    },$s);
}
function captionSyllables(string $text):int {
    $text=preg_replace_callback('/\d+/',fn($m)=>strlen($m[0])<=9?integerWords((int)$m[0]):'',speechScript($text));
    $n=0;
    foreach(preg_split('/[^A-Za-z]+/',strtolower($text),-1,PREG_SPLIT_NO_EMPTY)as $w){
        $g=preg_match_all('/[aeiouy]+/',$w);
        if($g===0){$n+=strlen($w);continue;}
        if($g>1&&str_ends_with($w,'e')&&!str_ends_with($w,'le'))$g--;
        $n+=max(1,$g);
    }
    return max(1,$n);
}
/** Break one sentence into short phrase units; names, price and website stay together. */
function captionUnits(string $sentence,string $vehicle=''):array {
    $s=$sentence;$protect=[];
    if($vehicle!=='')$protect[]=preg_quote($vehicle,'/');
    $protect[]='Golden Auto';$protect[]='test drive';$protect[]='(?:Just|Priced at)\s+\$[\d,]+(?:\.\d+)?';
    foreach($protect as $re)$s=preg_replace_callback('/'.$re.'/iu',fn($m)=>preg_replace('/\s+/',"\x01",$m[0]),$s);
    $tokens=preg_split('/\s+/u',trim($s),-1,PREG_SPLIT_NO_EMPTY);$units=[];$carry='';
    foreach($tokens as $i=>$t){
        $bare=strtolower(trim($t,".,!?;:\"'"));$last=$i===count($tokens)-1;
        if(!$last&&in_array($bare,CAPTION_GLUE,true)){$carry.=$t."\x02";continue;}
        $units[]=$carry.$t;$carry='';
    }
    if($carry!=='')$units[]=rtrim($carry,"\x02");
    $out=[];foreach($units as $u){$plain=str_replace(["\x01","\x02"],' ',$u);$out[]=['text'=>$u,'plain'=>$plain,'weight'=>captionSyllables($plain)];}
    return $out;
}
/** Wrap one cue to at most two short lines, avoiding breaks inside names and prices. */
function captionWrap(string $text):string {
    $plain=fn(string $x)=>str_replace(["\x01","\x02"],' ',$x);
    if(strlen($plain($text))<=CAPTION_MAX_LINE)return $plain($text);
    $best=null;$bestScore=PHP_INT_MAX;
    // Candidate break positions are every space; protected spaces cost extra.
    for($i=0;$i<strlen($text);$i++){
        $c=$text[$i];if($c!==' '&&$c!=="\x01"&&$c!=="\x02")continue;
        $a=trim($plain(substr($text,0,$i)));$b=trim($plain(substr($text,$i+1)));
        if($a===''||$b==='')continue;
        $over=max(0,strlen($a)-CAPTION_MAX_LINE)+max(0,strlen($b)-CAPTION_MAX_LINE);
        $score=$over*1000+($c===' '?0:($c==="\x02"?40:100))+abs(strlen($a)-strlen($b));
        if($score<$bestScore){$bestScore=$score;$best=$a."\n".$b;}
    }
    return $best??$plain($text);
}
/** Cue list: [['text','start','end'],...] with times relative to the start of the narration audio. */
function captionCues(string $script,string $vehicle,array $spans,float $audioEnd):array {
    $display=captionDisplayText($script);$vehicle=$vehicle===''?'':captionDisplayText($vehicle);
    $sentences=preg_split('/(?<=[.!?])\s+/u',$display,-1,PREG_SPLIT_NO_EMPTY);if(!$sentences)return [];
    $spans=array_values(array_filter($spans,fn($s)=>$s[1]-$s[0]>=0.05));
    if(!$spans)$spans=[[0.2,max(0.5,$audioEnd-0.2)]];
    $segments=captionSegments($spans,count($sentences));
    $sentenceUnits=[];foreach($sentences as $sentence)$sentenceUnits[]=captionUnits($sentence,$vehicle);
    $cues=[];$grand=max(1,array_sum(array_map(fn($u)=>array_sum(array_column($u,'weight')),$sentenceUnits)));
    $allVoiced=0.0;foreach($spans as $sp)$allVoiced+=$sp[1]-$sp[0];$before=0;
    foreach($sentenceUnits as $si=>$units){
        $total=max(1,array_sum(array_column($units,'weight')));
        if($segments){ // pauses in the audio match the sentences: map each sentence onto its own segment
            $segment=$segments[$si];$base=0.0;$voiced=0.0;foreach($segment as $sp)$voiced+=$sp[1]-$sp[0];
        }else{ // otherwise spread sentences over all speech by syllable weight
            $segment=$spans;$base=$allVoiced*$before/$grand;$voiced=$allVoiced*$total/$grand;
        }
        $before+=$total;
        $groups=[];$cur=[];$len=0;
        foreach($units as $u){$l=strlen($u['plain'])+($cur?1:0);
            if($cur&&$len+$l>CAPTION_MAX_CUE){$groups[]=$cur;$cur=[];$len=0;$l=strlen($u['plain']);}
            $cur[]=$u;$len+=$l;}
        if($cur)$groups[]=$cur;
        $done=0;
        foreach($groups as $g){
            $w=array_sum(array_column($g,'weight'));
            $a=captionVoicedTime($segment,$base+$voiced*$done/$total);$b=captionVoicedTime($segment,$base+$voiced*($done+$w)/$total);$done+=$w;
            $cues[]=['text'=>captionWrap(implode(' ',array_column($g,'text'))),'start'=>$a,'end'=>$b];
        }
    }
    // Small lead-in, short hold, minimum on-screen time, never overlapping.
    $n=count($cues);
    for($i=0;$i<$n;$i++){
        $next=$cues[$i+1]["start"]??($audioEnd+0.08);
        $start=max(0,$cues[$i]['start']-0.04);
        $end=max($cues[$i]['end']+0.2,$start+0.8);
        $cues[$i]['start']=$start;$cues[$i]['end']=min($end,$next-0.04);
        if($cues[$i]['end']<=$cues[$i]['start']+0.2)$cues[$i]['end']=$cues[$i]['start']+0.2;
        if($i+1<$n)$cues[$i+1]['start']=max($cues[$i+1]['start'],$cues[$i]['end']+0.04);
    }
    return $cues;
}
/** Split voiced spans into exactly $count sentence segments using pauses; null when pauses don't match. */
function captionSegments(array $spans,int $count):?array {
    if($count===1)return [$spans];
    foreach([0.45,0.35,0.28,0.22,0.17,0.12]as $gapMin){
        $segs=[[]];
        foreach($spans as $i=>$sp){
            if($i>0&&$sp[0]-$spans[$i-1][1]>=$gapMin)$segs[]=[];
            $segs[count($segs)-1][]=$sp;
        }
        if(count($segs)===$count)return $segs;
    }
    return null;
}
/** Position in real time after $voiced seconds of speech, skipping silence between spans. */
function captionVoicedTime(array $spans,float $voiced):float {
    foreach($spans as $sp){$len=$sp[1]-$sp[0];if($voiced<=$len+1e-9)return $sp[0]+max(0,$voiced);$voiced-=$len;}
    return (float)end($spans)[1];
}
function captionSrt(array $cues,float $offset=0):string {
    $out='';foreach($cues as $i=>$c)$out.=($i+1)."\n".srtTime($c['start']+$offset).' --> '.srtTime($c['end']+$offset)."\n".$c['text']."\n\n";
    return $out;
}
/** Generic draft (no audio analysis): spread phrase cues over the video. Prefer goldenFinishDraft for approved narration. */
function captionDraft(string $script,float $duration,string $vehicle=''):string {
    return captionSrt(captionCues($script,$vehicle,[[0.2,max(1.0,$duration-0.6)]],$duration));
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
