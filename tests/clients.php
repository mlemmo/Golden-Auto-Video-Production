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
}finally{
    foreach(glob("$dir/data/*") as $f)unlink($f);rmdir("$dir/data");rmdir($dir);
}
