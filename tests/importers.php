<?php
declare(strict_types=1);
// Dealer Car Search website importer. No network: the website and its photos are faked.
require __DIR__.'/../private/app.php';require __DIR__.'/../private/importers.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$dir=sys_get_temp_dir().'/ga-imp-'.bin2hex(random_bytes(4));mkdir("$dir/assets",0700,true);mkdir("$dir/data",0700);
$cfg=['asset_dir'=>"$dir/assets",'data_dir'=>"$dir/data",'public_base_url'=>'https://example.com:4343'];$db=db($cfg);
$page=fn(string $id,string $year,string $make,string $model,string $price,string $stock,string $miles,int $photos=3)=>
    '<html><script>var init_utag_data = { "site_company_name": "eLeaseReturns", "site_company_city": "San Ramon", "site_company_state": "CA", "site_phone_main": "800-407-0303",'
    .' "product_make": "'.$make.'", "product_model": "'.$model.'", "product_year": "'.$year.'", "product_price": "'.$price.'", "product_condition": "USED", "product_id": "'.$id.'", };</script>'
    .'<ul><li class="detailOptTrim"><label>Trim:</label> S COUPE**LIFT**HEAT SEATS</li><li class="detailOptColor"><label>Color:</label> CHALK</li>'
    .'<li class="detailOptDrive"><label>Drive Train:</label> RWD</li><li class="detailOptMPG"><label>Mileage:</label> '.$miles.'</li>'
    .'<li class="detailOptStock"><label>Stock #:</label> '.$stock.'</li><li class="detailOptVin"><label>Vin:</label> VIN'.$stock.'</li></ul>'
    .'<div class="i05r_detailPrice"><span class="price">$'.number_format((float)$price).'</span></div>'
    .'<form><input class="loanCalcPrice" value="999999"></form><div class="i05r_detailNotes">Vehicle Description CLEAN CARFAX. WE CHARGE A $80.00 DOC FEE.</div>'
    .implode('',array_map(fn($i)=>"<img data-src='https://imagescdn.dealercarsearch.com/Media/3073/$id/p$i.jpg'>",range(1,$photos)))
    .'<img src="https://imagescdn.dealercarsearch.com/Media/3073/999/other.jpg"></html>';
$jpeg=function(int $shade){$i=imagecreatetruecolor(200,150);imagefill($i,0,0,imagecolorallocate($i,$shade,$shade,$shade));ob_start();imagejpeg($i);return (string)ob_get_clean();};
$fetches=[];
$site=['https://lr.com/sitemap'=>'<loc>https://lr.com/vdp/1/Used-2026-Porsche-911</loc><loc>https://lr.com/vdp/2/Used-2023-Audi-Q5</loc><loc>https://lr.com/bdp/9/blog</loc>',
    'https://lr.com/vdp/1/Used-2026-Porsche-911'=>$page('1','2026','Porsche','911','177995.00','0931','2,599',10),
    'https://lr.com/vdp/2/Used-2023-Audi-Q5'=>$page('2','2023','Audi','Q5','31995.00','0944','18,250')];
$fetch=function(string $url)use(&$site,&$fetches,$jpeg){$fetches[]=$url;
    if(isset($site[$url]))return ['code'=>200,'body'=>$site[$url],'url'=>$url,'headers'=>''];
    if(preg_match('~/p(\d+)\.jpg$~',$url,$m))return ['code'=>200,'body'=>$jpeg(20*(int)$m[1]),'url'=>$url,'headers'=>''];
    return ['code'=>404,'body'=>'','url'=>$url,'headers'=>''];};
try{
    $v=dcsParseVdp($site['https://lr.com/vdp/1/Used-2026-Porsche-911'],'https://lr.com/vdp/1/x');
    verify($v['Year']===2026&&$v['Make']==='PORSCHE'&&$v['Model']==='911'&&$v['Trim']==='S COUPE'&&$v['StockNumber']==='0931'&&$v['Vin']==='VIN0931'&&$v['Odometer']===2599,'vehicle facts read from the listing page; dealer notes stripped from the trim');
    verify($v['price']===177995.0,'price from the listing, not the loan calculator or the fee text');
    verify(count($v['photo_sources'])===10&&!in_array('https://imagescdn.dealercarsearch.com/Media/3073/999/other.jpg',$v['photo_sources'],true),'only this car’s photos');
    verify($v['description']==='CLEAN CARFAX. WE CHARGE A $80.00 DOC FEE.'&&($v['dealer']['telephone']??'')==='800-407-0303','description and dealer details');

    $db->exec("INSERT INTO state VALUES ('clients','".json_encode(['items'=>[['id'=>'golden-auto','name'=>'Golden Auto','website'=>'https://www.mygoldenauto.net'],['id'=>'lr','name'=>'LR','website'=>'https://lr.com','analysis'=>['sitemap'=>'https://lr.com/sitemap']]]])."')");
    $r=clientImportDcs($db,$cfg,clientFind($db,'lr'),$fetch);
    verify($r['report']['added']===2&&count($r['vehicles'])===2&&!$r['report']['errors'],'both cars imported; blog pages ignored');
    $p=clientInventory($db,'lr')['vehicles'][0];
    verify(count($p['photos'])===DCS_PHOTOS&&preg_match('~^https://example\.com:4343/assets/[a-f0-9]{40}\.jpg$~',$p['photos'][0])===1&&is_file("$dir/assets/".basename($p['photos'][0])),'first 8 photos copied to this server as local JPEGs');
    verify(state($db,'inventory')===null,'Golden Auto inventory untouched');
    verify((clientFind($db,'lr')['dealer']['name']??'')==='eLeaseReturns','dealer details saved on the client');

    $fetches=[];unset($site['https://lr.com/vdp/2/Used-2023-Audi-Q5']);$site['https://lr.com/sitemap']='<loc>https://lr.com/vdp/1/Used-2026-Porsche-911</loc>';
    $r=clientImportDcs($db,$cfg,clientFind($db,'lr'),$fetch);
    $inv=array_column(clientInventory($db,'lr')['vehicles'],null,'StockNumber');
    verify($r['report']['updated']===1&&$r['report']['gone']===1&&$inv['0944']['active']===false&&$inv['0931']['active']===true,'a car that left the website stays listed as inactive');
    verify(!array_filter($fetches,fn($u)=>str_ends_with($u,'.jpg')),'unchanged photos are not downloaded again');
    $site['https://lr.com/sitemap']='<loc>https://lr.com/about</loc>';
    try{clientImportDcs($db,$cfg,clientFind($db,'lr'),$fetch);verify(false,'empty sitemap rejected');}catch(RuntimeException $e){verify(str_contains($e->getMessage(),'no vehicle pages'),'empty sitemap rejected');}
}finally{
    foreach([...glob("$dir/assets/*"),...glob("$dir/data/*")] as $f)unlink($f);rmdir("$dir/assets");rmdir("$dir/data");rmdir($dir);
}
