<?php
declare(strict_types=1);
// Clients and website analysis. No network: websites are faked.
require __DIR__.'/../private/app.php';require __DIR__.'/../private/clients.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$dir=sys_get_temp_dir().'/ga-cli-'.bin2hex(random_bytes(4));mkdir("$dir/data",0700,true);
$db=db(['data_dir'=>"$dir/data"]);
$expectError=function(callable $f,string $text,string $name){try{$f();verify(false,$name);}catch(RuntimeException $e){verify(str_contains($e->getMessage(),$text),$name);}};
$site=function(array $pages){return function(string $url)use($pages){foreach($pages as $suffix=>$page)if(str_ends_with($url,$suffix))return $page+['url'=>$url,'headers'=>''];return ['code'=>404,'body'=>'','url'=>$url,'headers'=>''];};};
try{
    $c=clientsLoad($db);
    verify(count($c['items'])===1&&$c['items'][0]['id']==='golden-auto'&&$c['items'][0]['name']==='Golden Auto','Golden Auto is the first client');
    verify(clientInventoryKey('golden-auto')==='inventory'&&clientInventoryKey('bay-motors')==='inventory:bay-motors','Golden Auto keeps its inventory; other clients get their own');
    $expectError(fn()=>clientInventoryKey('../x'),'Invalid client','client ids are checked');

    $dc=$site(['.com'=>['code'=>200,'body'=>'<html><script src="/inv-scripts-v2/inv/vehicles?cb=dws_inventory_listing_1"></script>'
        .'<script type="application/ld+json">{"@type":"AutoDealer","name":"Bay Motors","telephone":"555-0100","address":{"addressLocality":"Oakland","addressRegion":"CA"}}</script></html>'],
        '/robots.txt'=>['code'=>200,'body'=>"Sitemap: https://www.baymotors.com/sitemap.xml"],
        '/sitemap.xml'=>['code'=>200,'body'=>'<loc>https://www.baymotors.com/inventory/ford-f150-1/</loc><loc>https://www.baymotors.com/inventory/kia-soul-2/</loc><loc>https://www.baymotors.com/about</loc>']]);
    $a=clientAnalyze('https://www.baymotors.com',$dc);
    verify($a['platform']==='DealerCenter'&&$a['best']==='feed'&&in_array('website_dealercenter',array_column($a['options'],'method'),true),'DealerCenter site: feed first, website reader works now');
    verify(($a['dealer']['name']??'')==='Bay Motors'&&($a['dealer']['city']??'')==='Oakland'&&$a['vehicle_pages']===2,'dealer details and vehicle pages found');

    $cf=$site(['.com'=>['code'=>403,'body'=>'<title>Just a moment...</title> cf-chl']]);
    $b=clientAnalyze('https://www.blocked.com',$cf);
    verify($b['blocked']&&$b['best']==='browser_snapshot','site behind bot protection: browser snapshot recommended');

    $plain=$site(['.com'=>['code'=>200,'body'=>'<html><h1>Used cars</h1></html>']]);
    verify(clientAnalyze('https://www.plain.com',$plain)['best']==='zip','nothing recognisable: manual import');
    $ddc=$site(['.com'=>['code'=>200,'body'=>'<img src="https://pictures.dealer.com/x.jpg">']]);
    verify(clientAnalyze('https://www.ddc.com',$ddc)['platform']==='Dealer.com (Cox Automotive)','Dealer.com sites recognised');

    $new=clientAdd($db,'Bay Motors','baymotors.com',$dc);
    verify($new['id']==='bay-motors'&&$new['website']==='https://baymotors.com'&&$new['analysis']['platform']==='DealerCenter','client added with its website analysis');
    verify(count(clientsLoad($db)['items'])===2&&clientFind($db,'bay-motors')['name']==='Bay Motors','client saved and selectable');
    $expectError(fn()=>clientAdd($db,'bay motors','other.com',$dc),'already exists','duplicate name rejected');
    $expectError(fn()=>clientAdd($db,'Other','https://baymotors.com/cars',$dc),'already belongs','duplicate website rejected');
    $expectError(fn()=>clientAdd($db,'Local','http://localhost',$dc),'website','private website rejected');
    $expectError(fn()=>clientAdd($db,'','x.com',$dc),'client name','name required');
    verify(clientInventory($db,'bay-motors')===['vehicles'=>[]],'new client starts with an empty inventory');

    // Dealer details in scripts and speech
    verify(clientDetails(clientFind($db,'golden-auto'))===['name'=>'Golden Auto','city'=>'San Ramon','website'=>'mygoldenauto.net','website_spoken'=>'my golden auto dot net'],'Golden Auto details unchanged');
    $bd=clientDetails(clientFind($db,'bay-motors'));
    verify($bd['name']==='Bay Motors'&&$bd['city']==='Oakland'&&$bd['website']==='baymotors.com'&&$bd['website_spoken']==='bay motors dot com','new client: its name, the city found on its website, and its website by default');
    verify(clientWebsiteSpoken('eleasereturns.com','eLease Returns')==='e lease returns dot com'&&clientWebsiteSpoken('abc-cars.net','Smith Auto')==='abc cars dot net','spoken website from the name when it matches the domain');
    $car=['Year'=>2016,'Make'=>'LAND ROVER','Model'=>'RANGE ROVER SPORT','Trim'=>'HSE','Drivetrain'=>'4WD','ExteriorColor'=>'LOIRE BLUE','Odometer'=>67351,'price'=>null];
    $saved=clientSaveDetails($db,'bay-motors',['name'=>'eLease Returns','city'=>'San Ramon','website'=>'https://www.eleasereturns.com/','website_spoken'=>'']);
    $ed=clientDetails($saved);
    verify($ed['website']==='eleasereturns.com'&&$ed['website_spoken']==='e lease returns dot com'&&$ed['city']==='San Ramon','details saved and cleaned');
    $s30=script($car,30,$ed);$s15=script($car,15,$ed);
    verify(str_contains($s30,'here at eLease Returns in San Ramon.')&&str_contains($s30,'at eleasereturns.com.')&&!str_contains($s30.$s15,'Golden Auto')&&!str_contains($s30.$s15,'mygoldenauto'),'scripts name the client and its website');
    verify(str_contains(script($car,30),'Golden Auto in San Ramon')&&str_contains(script($car,30),'mygoldenauto.net'),'Golden Auto scripts unchanged');
    speechSites([$ed['website']=>$ed['website_spoken']]);
    verify(str_contains(speechScript($s30),'at e lease returns dot com.')&&str_contains(nativeSpeech($s30),'e lease returns dot com')&&str_contains(speechScript('HSE'),'H-S-E'),'the voice says the client website in words');
    speechSites([]);
    $expectError(fn()=>clientSaveDetails($db,'golden-auto',['name'=>'X','website'=>'x.com']),'fixed','Golden Auto details cannot be changed');
    $expectError(fn()=>clientSaveDetails($db,'bay-motors',['name'=>'X','website'=>'not a site']),'website','bad website rejected');
}finally{
    foreach(glob("$dir/data/*") as $f)unlink($f);rmdir("$dir/data");rmdir($dir);
}
