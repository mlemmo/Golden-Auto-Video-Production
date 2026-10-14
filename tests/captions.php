<?php
require __DIR__.'/../private/app.php';
function assertCaption(bool $v,string $label):void{if(!$v)throw new RuntimeException('FAIL '.$label);echo "PASS $label\n";}
foreach(['$14,688.25'=>'fourteen thousand six hundred eighty-eight dollars and twenty-five cents','$1.01'=>'one dollar and one cent','$0.25'=>'zero dollars and twenty-five cents','$20.00'=>'twenty dollars','$8826.25'=>'eight thousand eight hundred twenty-six dollars and twenty-five cents']as $input=>$expected)assertCaption(speechScript($input)===$expected,$input.' speech');
assertCaption(speechScript('Price $14,688.25 dollars.')==='Price fourteen thousand six hundred eighty-eight dollars and twenty-five cents.','no duplicate dollars');
assertCaption(speechWordCount('$14,688.25')>1,'speech count includes expanded currency');
$s=captionDraft('Golden Auto in San Ramon. Priced at $14,688.25.',15);
assertCaption(str_contains($s,'$14,688.25')&&!str_contains($s,'San Ramon'),'captions keep numeric price and match spoken location');
assertCaption(validateSrt($s,15)!=='','draft has valid ordered times');
try{validateSrt("1\n00:00:10,000 --> 00:00:09,000\nBad",15);throw new LogicException('Bad time accepted');}catch(RuntimeException $e){assertCaption(true,'reversed time rejected');}
file_put_contents(sys_get_temp_dir().'/golden-caption-test.srt',$s);

// --- Phrase-aware, audio-aligned caption engine ---
assertCaption(captionDisplayText('Explore this 2013 SUBARU XV CROSSTREK at GOLDEN AUTO. Priced at $14,688.00.')==='Explore this 2013 Subaru XV Crosstrek at Golden Auto. Priced at $14,688.','all-caps inventory text and .00 cents cleaned');
assertCaption(captionDisplayText('Honda CR-V and RAV4 SUV')==='Honda CR-V and RAV4 SUV','hyphen/digit names and SUV acronym preserved');
$script='Explore this 2013 SUBARU XV CROSSTREK at Golden Auto. Just $14,688.00. Book your test drive at mygoldenauto.net.';
$spans=[[0.02,4.86],[5.22,7.88],[8.3,11.14]];  // measured from the real approved narration
$cues=captionCues($script,'2013 SUBARU XV CROSSTREK',$spans,11.15);
assertCaption(count($cues)===5,'five phrase cues');
assertCaption($cues[0]['text']==="Explore this\n2013 Subaru XV Crosstrek",'vehicle name kept together on one line');
assertCaption(str_contains(implode('|',array_column($cues,'text')),'Just $14,688.'),'price cue has Just + whole dollars');
assertCaption(abs($cues[3]['start']-8.26)<0.2&&abs($cues[2]['start']-5.18)<0.2,'sentence cues start at measured pauses');
$prev=0;$ok=true;foreach($cues as $c){if($c['start']<$prev||$c['end']<=$c['start']||$c['end']>11.15+0.1)$ok=false;$prev=$c['end'];foreach(explode("\n",$c['text'])as $line)if(strlen($line)>CAPTION_MAX_LINE)$ok=false;}
assertCaption($ok,'cues ordered, inside speech, lines short enough');
assertCaption(validateSrt(captionSrt($cues,2.0),15)!=='','shifted SRT passes validation');
$fallback=captionCues($script,'2013 SUBARU XV CROSSTREK',[[0.0,11.0]],11.15);
assertCaption(count($fallback)===5&&$fallback[4]['end']<=11.23,'single-span fallback spreads cues over the speech');
assertCaption(speechScript('Visit https://www.mygoldenauto.net.')==='Visit my golden auto dot N, E, T.','website spelling for speech');
assertCaption(speechScript('Visit mygoldenauto.net.')==='Visit my golden auto dot N, E, T.','plain website for speech');
assertCaption(str_contains(script(['Year'=>2013,'Make'=>'SUBARU','Model'=>'XV CROSSTREK','price'=>14688.0]),'Just $14,688.'),'default script uses approved "Just" wording and whole dollars');
