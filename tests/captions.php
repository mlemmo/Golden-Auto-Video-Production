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
