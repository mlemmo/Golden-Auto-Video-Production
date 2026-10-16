<?php
require __DIR__.'/../private/app.php';
function check(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL: '.$name);echo "PASS: $name\n";}
check(jsonp('callback({"Vehicles":[]});')===['Vehicles'=>[]],'JSONP extraction');
check(highestPrice(['VehiclePrice'=>8688,'TotalAskingPrice'=>8826.25,'TotalAdvertisingPrice'=>0],[['VehiclePrice'=>9000]])===9000.0,'highest price across same vehicle sources');
check(highestPrice(['VehiclePrice'=>0,'TotalPrice'=>-1])===null,'call-for-price stays unknown');
$v=['Year'=>2011,'Make'=>'HONDA','Model'=>'CR-V','Drivetrain'=>'4WD','price'=>8826.25];
check(str_contains(script($v),'Just $8,826.')&&!str_contains(script($v),'.25'),'script uses selected price in whole dollars');
check(str_contains(prompt($v,'Test spoken script.'),'15-second'),'15-second recipe');
$long=['Year'=>2015,'Make'=>'RAM','Model'=>'1500 CREW CAB','Trim'=>'Laramie Longhorn Pickup 4D 5 1/2 ft','Drivetrain'=>'4WD','ExteriorColor'=>'Green','Odometer'=>154785,'price'=>15688.25];
$s30=script($long,30);
check(script($v,15)===script($v)&&speechWordCount(script($v))<=38,'15-second script unchanged and within limit');
check(speechWordCount($s30)>=45&&speechWordCount($s30)<=62,'30-second script fills most of the time ('.speechWordCount($s30).' spoken words)');
check(str_contains($s30,'Laramie Longhorn')&&!str_contains($s30,'Pickup 4D')&&str_contains($s30,'four-wheel drive')&&str_contains($s30,'just over 154,000 miles')&&str_contains($s30,'truck'),'30-second script uses trim, drive, mileage and body style');
check(str_contains($s30,'Just $15,688.')&&!str_contains($s30,'.25')&&str_contains($s30,'mygoldenauto.net'),'30-second script keeps whole-dollar price and website');
check(speechScript('Explore this 2013 SUBARU XV CROSSTREK with AWD. A great SUV!')==='Explore this twenty thirteen Subaru X-V Crosstrek with A-W-D. A great S-U-V!','acronyms spelled, years as words, all-caps words normal case');
check(speechScript('2011 HONDA CR-V EX-L, 2022 MAZDA CX-30, 2018 VOLVO XC90 T6, 2015 BMW 3 SERIES 328d, 2015 RAM 1500 CREW CAB, 2008 TOYOTA 4RUNNER, 4WD')==='twenty eleven Honda C-R-V E-X-L, twenty twenty-two Mazda C-X 30, twenty eighteen Volvo X-C 90 T 6, twenty fifteen B-M-W 3 Series 328d, twenty fifteen Ram 1500 Crew Cab, two thousand eight Toyota 4 Runner, 4-W-D','model codes spelled for speech, years as words');
check(str_contains(speechScript('Book at mygoldenauto.net. I like it.'),'my golden auto dot N, E, T. I like it.'),'website and plain words untouched');
check(str_contains(script($v),'with 4WD'),'15-second script keeps drive code uppercase');
check(!str_contains(speechScript('Just $14,688. Call now.'),'$')&&str_contains(speechScript('Just $14,688. Call now.'),'dollars. Call now.'),'whole-dollar price before a period is spoken as words');
check(speechScript('with 2WD')==='with 2-W-D','2WD spelled');
check(adPrice(14688.25)==='$14,688'&&adPrice(14688.0)==='$14,688'&&adPrice(999.99)==='$999','ad price drops cents');
try{publicImage('http://localhost/image.jpg');check(false,'blocked URL');}catch(RuntimeException $e){check(true,'insecure/private URL blocked');}
check(publicImage('https://example.com/sheet.jpg')==='https://example.com/sheet.jpg','HTTPS reference accepted');

$fixture='<div id="DWS_VDP_Media_5"><div data-pin-media="https://imagescf.dealercenter.net/640/480/own.jpg"></div></div><div id="similar"><img src="https://imagescf.dealercenter.net/640/480/other.jpg"></div>';
check(galleryPhotos($fixture)===['https://imagescf.dealercenter.net/640/480/own.jpg'],'gallery excludes similar vehicles');
check(count(samplePhotos(range(1,29)))===9 && samplePhotos(range(1,29))[8]===29,'sampling covers beginning and end');
check(samplePhotos(['a','b'])===['a','b'],'small gallery preserved');
