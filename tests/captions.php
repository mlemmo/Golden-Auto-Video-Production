<?php
require __DIR__.'/../private/app.php';
function assertCaption(bool $v,string $label):void{if(!$v)throw new RuntimeException('FAIL '.$label);echo "PASS $label\n";}
foreach(['$14,688.25'=>'fourteen thousand six hundred eighty-eight dollars and twenty-five cents','$1.01'=>'one dollar and one cent','$0.25'=>'zero dollars and twenty-five cents','$20.00'=>'twenty dollars','$8826.25'=>'eight thousand eight hundred twenty-six dollars and twenty-five cents']as $input=>$expected)assertCaption(speechScript($input)===$expected,$input.' speech');
assertCaption(speechScript('Price $14,688.25 dollars.')==='Price fourteen thousand six hundred eighty-eight dollars and twenty-five cents.','no duplicate dollars');
assertCaption(speechWordCount('$14,688.25')>1,'speech count includes expanded currency');
$s=captionDraft('Golden Auto in San Ramon. Priced at $14,688.25.',15);
assertCaption(str_contains($s,'$14,688.25')&&str_contains($s,'San Ramon'),'captions keep numeric price and say San Ramon like the narration');
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

// --- Captions show exactly the approved caption text, timed by what she actually said ---
// Recognized words from a real Seedance take: she added "a Subaru X", said the price twice and "San Ramon" came back as "Ramio".
$take='Looking for a dependable SUV? Take a look at this 2013 SUBARU XV CROSSTREK Premium, here at Golden Auto in San Ramon. It comes with all-wheel drive, a silver exterior, and just over 60,000 miles. Just $14,688. Book your test drive today at mygoldenauto.net.';
$heard=[];foreach(explode(' ','Looking for a dependable SUV? Take a look at this 2013 Subaru XV Crosstrek Premium here at Golden Auto in San Ramio. It comes with all-wheel drive, a Subaru X, a silver exterior, and just oast over 60,000 miles. Just $14,688. Just $14,688. Book your test drive today at MyGoldenAuto.net.')as $k=>$w)$heard[]=[$w,$k*0.5,$k*0.5+0.4];
$timing=captionSpokenScript($take,$heard);
assertCaption($timing!==null&&str_replace(CAPTION_EXTRA,'',preg_replace('/\x03\S+ ?/','',$timing))===captionDisplayText($take),'timing text is the caption text plus marked added words');
assertCaption(substr_count((string)$timing,CAPTION_EXTRA)===6,'added words (a Subaru X, oast, the repeated price) are marked');
$skipped=captionSpokenScript('Book your test drive today at mygoldenauto.net.',[['Book',0,.3],['your',.3,.5],['test',.5,.8],['drive',.8,1],['at',1.1,1.2],['mygoldenauto.net.',1.2,2]]);
assertCaption($skipped==='Book your test drive today at mygoldenauto.net.','a word she skipped stays in the caption text');
assertCaption(captionSpokenScript($take,[['Hello',0,.5],['there',.5,1]])===null,'too little recognized: time the caption text alone');
// Voiced spans measured from that take: captions keep the approved wording and each one starts at its real pause.
$spans=[[0.4,2.06],[2.27,7.37],[8.52,12.43],[12.7,14.75],[15.87,18.74],[19.19,21.95],[23.43,24.74],[25.02,26.69]];
$heard2=[];foreach(explode(' ','Looking for a dependable SUV? Take a look at this 2013 Subaru XV Crosstrek Premium here at Golden Auto in San Ramio. It comes with all-wheel drive, a Subaru X, a silver exterior, and just over 60,000 miles. Just $14,688. Just $14,688. Book your test drive today at MyGoldenAuto.net.')as $k=>$w)$heard2[]=[$w,$k*0.5,$k*0.5+0.4];
$cues=captionCues((string)captionSpokenScript($take,$heard2),'2013 SUBARU XV CROSSTREK',$spans,26.69);
$all=implode(' ',array_map(fn($c)=>str_replace("\n",' ',$c['text']),$cues));
assertCaption($all===captionDisplayText($take),'captions show exactly the approved caption text, nothing added or removed');
assertCaption(!str_contains($all,CAPTION_EXTRA)&&substr_count($all,'Just $14,688.')===1&&!str_contains($all,'Subaru X,'),'added words and the repeat are never shown');
$at=[];foreach($cues as $c)$at[str_replace("\n",' ',$c['text'])]=$c;
assertCaption(abs($at['It comes with all-wheel drive,']['start']-8.48)<0.15&&abs($at['and just over 60,000 miles.']['end']-14.95)<0.25,'mileage caption is gone before the price is said');
assertCaption(abs($at['Book your test drive today']['start']-23.39)<0.15&&abs(end($cues)['end']-26.73)<0.25,'captions after the repeat are still on time');

// --- No advertised price: no price in the scripts, "Call For Price" caption after the speech ---
$noPrice=['Year'=>2016,'Make'=>'LAND ROVER','Model'=>'RANGE ROVER SPORT','Trim'=>'HSE','Drivetrain'=>'4WD','ExteriorColor'=>'LOIRE BLUE','Odometer'=>67351,'price'=>null];
assertCaption(!str_contains(script($noPrice),'$')&&!str_contains(script($noPrice,30),'$')&&!str_contains(strtolower(script($noPrice,30)),'price'),'no price: scripts never mention a price');
$cfp=captionCallForPrice([['text'=>'Book your test drive','start'=>20.0,'end'=>23.5]],29.5);
assertCaption(end($cfp)['text']==='Call For Price'&&abs(end($cfp)['start']-23.8)<0.01&&abs(end($cfp)['end']-29.3)<0.01,'Call For Price shown after the speech until the end');
$tight=captionCallForPrice([['text'=>'Book','start'=>20.0,'end'=>29.4]],29.5);
assertCaption(end($tight)['text']==='Call For Price'&&$tight[0]['end']<=28.1&&end($tight)['start']>$tight[0]['end']&&validateSrt(captionSrt($tight,0.5),30)!=='','speech to the very end: last caption shortened to make room');
assertCaption(priceMatches(null,null)&&!priceMatches(null,14688.0)&&priceMatches(14688.25,14688.25)&&!priceMatches(14688.0,14690.0),'no price matches no price only');

// --- Listing shorthand in speech: 4WD → four wheel drive, 4D / 4dr → four door; captions keep the shorthand ---
assertCaption(speechScript('2016 RANGE ROVER SPORT 4WD 4dr V6 HSE')==='twenty sixteen Range Rover Sport four wheel drive four door V 6 H-S-E'&&nativeSpeech('Sedan 4D with 4WD')==='Sedan four door with four wheel drive','4WD and 4D/4dr said as words');
assertCaption(speechScript('Q4 4DRV')!==''&&!str_contains(speechScript('Q4 4DRV'),'four door')&&captionDisplayText('SPORT 4WD 4dr')==='Sport 4WD 4dr','other codes untouched; captions keep 4WD and 4dr');
assertCaption(speechScript('XT6 AWD, FWD sedan, RWD coupe, a 4x4 truck')==='X-T 6 all wheel drive, front wheel drive sedan, rear wheel drive coupe, a four by four truck'&&captionDisplayText('AWD FWD RWD 4x4')==='AWD FWD RWD 4x4','AWD, FWD, RWD and 4x4 said as words; captions keep them');

// --- Re-timing from recognized words (2013 Subaru take): comma said without a pause, repeated "miles.", short cue joined ---
$script='Looking for a dependable SUV? Take a look at this 2013 SUBARU XV CROSSTREK Premium, here at Golden Auto in San Ramon. It comes with all-wheel drive, a silver exterior, with just over 60,000 miles. Just $14,688. Book your test drive today at mygoldenauto.net.';
$heard=[['Looking', 0.31, 0.46], ['for', 0.46, 0.65], ['a', 0.65, 0.7], ['dependable', 0.7, 1.32], ['SUV?', 1.32, 1.74], ['Take', 2.4, 2.4], ['a', 2.4, 2.4], ['look', 2.4, 2.47], ['at', 2.47, 2.71], ['this', 2.71, 2.86], ['2013', 2.86, 3.76], ['Subaru', 3.76, 4.26], ['XV', 4.26, 4.85], ['Cross', 4.85, 4.89], ['Premium', 4.89, 5.46], ['here', 5.46, 5.7], ['at', 5.7, 5.82], ['Golden', 5.82, 6.23], ['Auto', 6.23, 6.53], ['in', 6.53, 6.54], ['San', 6.54, 6.72], ['Ramon.', 6.72, 7.24], ['It', 7.24, 7.55], ['comes', 7.55, 7.77], ['with', 7.77, 8.08], ['all-wheel', 8.08, 8.76], ['drive,', 8.76, 9.36], ['a', 9.36, 9.73], ['silver', 9.73, 9.82], ['exterior,', 9.82, 10.66], ['and', 10.66, 10.83], ['just', 10.83, 11.07], ['over', 11.07, 11.37], ['60,000', 11.37, 12.23], ['miles.', 12.23, 12.72], ['Just', 13.24, 13.55], ['14,060', 13.55, 15.03], ['miles.', 15.03, 15.92], ['Just', 16.56, 16.56], ['$14,688.', 16.56, 18.84], ['Book', 19.98, 19.98], ['your', 19.98, 20.05], ['test', 20.05, 20.29], ['drive', 20.29, 20.67], ['today', 20.67, 21.21], ['at', 21.21, 21.42], ['MyGoldenAuto.net.', 21.42, 23.76]];
$spans=[[0.31, 2.0], [2.49, 7.33], [7.9, 9.36], [9.69, 10.93], [11.11, 12.83], [13.25, 13.47], [13.66, 16.16], [16.58, 19.54], [20.59, 23.83]];
require_once __DIR__.'/../private/finishing.php';
$srt=goldenNativeCues(['script'=>$script,'vehicle'=>'2013 SUBARU XV CROSSTREK','duration'=>30,'price'=>14688],['spans'=>$spans,'speech_end'=>23.83],$heard);
preg_match_all('/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\n([\s\S]*?)(?:\n\n|\n?$)/',$srt,$m,PREG_SET_ORDER);
$cues=array_map(fn($x)=>[substr($x[1],6),substr($x[2],6),str_replace("\n",' / ',$x[3])],$m);
assertCaption($cues[1]===['02,450','05,420','Take a look / at this 2013 Subaru / XV Crosstrek Premium,'],'short "Crosstrek Premium," joined; no line ends on "at"');
assertCaption(array_slice($cues[2],0,2)===['05,420','07,530'],'"here at Golden Auto in San Ramon." while she says it, not a pause later');
assertCaption($cues[5]===['11,070','13,030','with just over / 60,000 miles.']&&$cues[6][0]==='16,540','first "miles.", nothing shown during her added line');
assertCaption(captionWrapLines('Take a look at this 2013 Subaru XV Crosstrek Premium, and more words here to overflow it')===null&&captionSnap([[1,2],[3,4]],2.8,true)===3.0,'wrap limit and snapping');
