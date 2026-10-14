<?php
require __DIR__.'/../private/app.php';
function check(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL: '.$name);echo "PASS: $name\n";}
check(jsonp('callback({"Vehicles":[]});')===['Vehicles'=>[]],'JSONP extraction');
check(highestPrice(['VehiclePrice'=>8688,'TotalAskingPrice'=>8826.25,'TotalAdvertisingPrice'=>0],[['VehiclePrice'=>9000]])===9000.0,'highest price across same vehicle sources');
check(highestPrice(['VehiclePrice'=>0,'TotalPrice'=>-1])===null,'call-for-price stays unknown');
$v=['Year'=>2011,'Make'=>'HONDA','Model'=>'CR-V','Drivetrain'=>'4WD','price'=>8826.25];
check(str_contains(script($v),'$8,826.25'),'script uses selected price');
check(str_contains(prompt($v,'Test spoken script.'),'15-second'),'15-second recipe');
try{publicImage('http://localhost/image.jpg');check(false,'blocked URL');}catch(RuntimeException $e){check(true,'insecure/private URL blocked');}
check(publicImage('https://example.com/sheet.jpg')==='https://example.com/sheet.jpg','HTTPS reference accepted');

$fixture='<div id="DWS_VDP_Media_5"><div data-pin-media="https://imagescf.dealercenter.net/640/480/own.jpg"></div></div><div id="similar"><img src="https://imagescf.dealercenter.net/640/480/other.jpg"></div>';
check(galleryPhotos($fixture)===['https://imagescf.dealercenter.net/640/480/own.jpg'],'gallery excludes similar vehicles');
check(count(samplePhotos(range(1,29)))===9 && samplePhotos(range(1,29))[8]===29,'sampling covers beginning and end');
check(samplePhotos(['a','b'])===['a','b'],'small gallery preserved');
