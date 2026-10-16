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
/** Years and comma-grouped numbers as words: "2013" → "twenty thirteen", "60,000" → "sixty thousand". */
function numberSpeech(string $s):string {
    $s=preg_replace_callback('/(?<![\d,.$])(19[5-9]\d|20[0-3]\d)(?![\d,])/',function($m){
        $y=(int)$m[1];
        if($y>=2000&&$y<2010)return integerWords($y);
        $hi=intdiv($y,100);$lo=$y%100;
        return integerWords($hi).' '.($lo===0?'hundred':($lo<10?'oh '.integerWords($lo):integerWords($lo)));
    },$s);
    return preg_replace_callback('/(?<![\d$.])(\d{1,3}(?:,\d{3})+)(?![\d,]|\.\d)/',fn($m)=>integerWords((int)str_replace(',','',$m[1])),$s);
}
function priceSpeech(string $s):string {
    // A sentence-ending period after the price ("Just $14,688.") must not block the conversion.
    return preg_replace_callback('/\$(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d,]|\.\d)(?:\s+dollars\b)?/i',fn($m)=>currencyWords($m[1]),$s);
}
function speechWordCount(string $s):int{return count(preg_split('/[\s-]+/u',speechScript($s,false),-1,PREG_SPLIT_NO_EMPTY));}
function srtTime(float $seconds):string {$ms=(int)round(max(0,$seconds)*1000);return sprintf('%02d:%02d:%02d,%03d',intdiv($ms,3600000),intdiv($ms%3600000,60000),intdiv($ms%60000,1000),$ms%1000);}
const CAPTION_MAX_LINE=24;
const CAPTION_MAX_CUE=40;
const CAPTION_GLUE=['this','the','a','an','your','at','to','in','of','for','on','with','and','or','our','my','from','by'];
const CAPTION_ACRONYMS=['SUV','AWD','FWD','RWD','4WD','GMC','BMW','CVT','TDI','TSI','WRX','STI','SRT','AMG','XLT','LED'];
/** Display text for captions: readable case, whole-dollar prices. */
function captionDisplayText(string $script):string {
    $s=trim(preg_replace('/\s+/u',' ',$script));
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
    // The car name plus up to three trim words that follow it ("2013 Subaru XV Crosstrek Premium").
    if($vehicle!=='')$protect[]=preg_quote($vehicle,'/').'(?:\s+(?!(?:'.implode('|',CAPTION_GLUE).'|here|now|today|today\b)\b)[A-Z][\w-]*){0,3}';
    $protect[]='Golden Auto';$protect[]='San Ramon';$protect[]='test drive';$protect[]='(?:Just|Priced at)\s+\$[\d,]+(?:\.\d+)?';
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
/**
 * Cue list: [['text','start','end'],...] with times relative to the start of the speech audio.
 * The script is split into clauses (sentence ends and commas). Real pauses in the audio are matched to clause
 * boundaries (dynamic programming on where each boundary is expected by syllable count), and words between
 * matched pauses are spread by syllables over the speech in between. Cues never cross a clause.
 */
function captionCues(string $script,string $vehicle,array $spans,float $audioEnd):array {
    $display=captionDisplayText($script);$vehicle=$vehicle===''?'':captionDisplayText($vehicle);
    $sentences=preg_split('/(?<=[.!?])\s+/u',$display,-1,PREG_SPLIT_NO_EMPTY);if(!$sentences)return [];
    $spans=array_values(array_filter($spans,fn($s)=>$s[1]-$s[0]>=0.05));
    if(!$spans)$spans=[[0.2,max(0.5,$audioEnd-0.2)]];
    // Units with their clause boundary strength: 2 = sentence end, 1 = comma/semicolon, 0 = none.
    $units=[];
    foreach($sentences as $sentence){
        $us=captionUnits($sentence,$vehicle);
        foreach($us as $k=>$u){$u['end']=$k===count($us)-1?2:(preg_match('/[,;:]$/',rtrim(str_replace(["\x01","\x02"],' ',$u['text'])))?1:0);$units[]=$u;}
    }
    $W=array_sum(array_column($units,'weight'));
    $V=0.0;$gaps=[];
    foreach($spans as $i=>$sp){$V+=$sp[1]-$sp[0];if($i<count($spans)-1)$gaps[]=['v'=>$V,'len'=>$spans[$i+1][0]-$sp[1]];}
    $map=captionAnchors($units,$gaps,$W,$V);
    // Cues: group units inside each clause up to CAPTION_MAX_CUE characters.
    $cues=[];$cur=[];$len=0;$w0=0.0;$w=0.0;
    $flush=function()use(&$cues,&$cur,&$len,&$w0,&$w,$map,$spans){
        if(!$cur)return;
        $a=captionVoicedTime($spans,captionMapWeight($map,$w0)+1e-6);$b=captionVoicedTime($spans,captionMapWeight($map,$w));
        $cues[]=['text'=>captionWrap(implode(' ',array_column($cur,'text'))),'start'=>$a,'end'=>max($b,$a+0.1)];
        $cur=[];$len=0;$w0=$w;
    };
    foreach($units as $u){
        $l=strlen($u['plain'])+($cur?1:0);
        if($cur&&$len+$l>CAPTION_MAX_CUE)$flush();
        $cur[]=$u;$len+=strlen($u['plain'])+($len?1:0);$w+=$u['weight'];
        if($u['end']>0)$flush();
    }
    $flush();
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
/**
 * Match audio pauses to clause boundaries. Returns control points [[weight, voiced seconds], ...] from (0,0) to (W,V).
 * Pauses shorter than 0.15 s are ignored; a long pause left unmatched, or a sentence end with no pause, costs more.
 */
function captionAnchors(array $units,array $gaps,float $W,float $V):array {
    $cands=[];$cw=0.0;
    foreach($units as $k=>$u){$cw+=$u['weight'];if($u['end']>0&&$k<count($units)-1)$cands[]=['w'=>$cw,'e'=>$V*$cw/max(1,$W),'s'=>$u['end']];}
    $gaps=array_values(array_filter($gaps,fn($g)=>$g['len']>=0.15));
    $n=count($gaps);$m=count($cands);
    if(!$n||!$m||$V<=0)return [[0,0],[$W,$V]];
    $skipGap=fn($g)=>0.03+0.12*min(1.5,$g['len']);
    $skipCand=fn($c)=>$c['s']===2?0.05:0.015;
    $dp=array_fill(0,$n+1,array_fill(0,$m+1,INF));$from=$dp;$dp[0][0]=0.0;
    for($i=0;$i<=$n;$i++)for($j=0;$j<=$m;$j++){
        $c=$dp[$i][$j];if($c===INF)continue;
        if($i<$n&&$c+$skipGap($gaps[$i])<$dp[$i+1][$j]){$dp[$i+1][$j]=$c+$skipGap($gaps[$i]);$from[$i+1][$j]=0;}
        if($j<$m&&$c+$skipCand($cands[$j])<$dp[$i][$j+1]){$dp[$i][$j+1]=$c+$skipCand($cands[$j]);$from[$i][$j+1]=1;}
        if($i<$n&&$j<$m){$cost=$c+abs($gaps[$i]['v']-$cands[$j]['e'])/$V;if($cost<$dp[$i+1][$j+1]){$dp[$i+1][$j+1]=$cost;$from[$i+1][$j+1]=2;}}
    }
    $pts=[];$i=$n;$j=$m;
    while($i>0||$j>0){$f=$from[$i][$j];if($f===2){$pts[]=[$cands[$j-1]['w'],$gaps[$i-1]['v']];$i--;$j--;}elseif($f===0)$i--;else $j--;}
    $pts=array_reverse($pts);array_unshift($pts,[0,0]);$pts[]=[$W,$V];
    return $pts;
}
/** Voiced-seconds position for a cumulative syllable weight, piecewise linear between anchors. */
function captionMapWeight(array $pts,float $w):float {
    for($k=1;$k<count($pts);$k++){
        [$w1,$v1]=$pts[$k-1];[$w2,$v2]=$pts[$k];
        if($w<=$w2+1e-9)return $w2>$w1?$v1+($v2-$v1)*($w-$w1)/($w2-$w1):$v2;
    }
    return (float)end($pts)[1];
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
